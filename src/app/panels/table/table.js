define([
  'angular',
  'jquery',
  'lodash'
],
  function (angular, $, _) {
    'use strict';

    var module = angular.module('grafana.directives');

    module.directive('grafanaTable', function($rootScope, $timeout) {
      var data;
      var sortedData; // will shadow the data

      // paging variables
      var dataToSkip;
      var pagedData;
      var numPages = 1;
      var minPage = 1;

      var tableHeight;

      var SortType = {
        none: 0,
        asc: 1,
        desc: 2
      };

      return {
        restrict: 'A',
        templateUrl: 'app/panels/table/table.html',
        link: function(scope, elem) {
          scope.panel.pageLimit = scope.panel.pageLimit || 20;
          scope.sortType = SortType;

          // refers to the order in which the columns were requested to be sorted
          // for example, we might want to first sort by second column, then by third, then by first, etc.
          // this does not necessarily refer to the physical order of the columns
          scope.panel.columnSortOrder = [];

          scope.$on('render',function(event, renderData) {
            data = renderData || data;
            if (!data) {
              scope.get_data();
              return;
            }

            sortedData = [].concat(data.datapoints); // on initial render, original data is the desired sort
            setupInitialPaging();
            renderTable();
          });


          // if user changes page
          scope.$watch('panel.curTablePage', function() {
            scope.panel.curTablePage = parseInt(scope.panel.curTablePage) || 1; // ensure page is numeric

            if (scope.panel.curTablePage < minPage) {
              scope.panel.curTablePage = minPage;
            }

            if (scope.panel.curTablePage > numPages) {
              scope.panel.curTablePage = numPages;
            }


            if (!data) {
              return;
            }

            renderTable();
          });

          // if user tries to sort
          scope.headerClicked = function(header) {
            if (!scope.panel.allowSorting) {
              return;
            }

            changeSortType(header);
            handleSorting();
            renderTable();
          };

          scope.panel.clearSortOrder = function() {
            _.each(scope.headers, function(column) {
              column.sortType = SortType.none;
            });

            scope.panel.columnSortOrder = [];
            sortedData = [].concat(data.datapoints); // set sorted data to initial data state
            renderTable();
          };

          scope.panel.adjustColumnWidth = function() {
            performHeaderPositioning();
          };


          function renderTable() {
            var isHeightSet = setTableHeightVariable();
            if (shouldAbortRender(isHeightSet)) {
              return;
            }

            setHeaders();
            handlePaging();
            setTableData();

            elem.find('.table-vis-overflow-container').height(tableHeight);
            elem.height(tableHeight); // set physical height of directive

            $timeout(function() { // after angular is processing, do jquery stuff
              performHeaderPositioning();
            }, 0);
          }

          // on resize, the absolutely positioned headers will be shifted, during shift we reposition them
          $(window).resize(function() {
            performHeaderPositioning();
          });


          // only set headers if there has been a change, since we do not want to lose pre existing sorting options
          function setHeaders() {
            var curHeaders = scope.headers;

            var newHeaders = _.map(data.selectedColumns, function(columnName) {
              return { columnName: columnName, sortType: SortType.none };
            });

            if (!curHeaders) {
              scope.headers = newHeaders;
              scope.panel.columnSortOrder = [];
              return;
            }


            var headersChanged = curHeaders.length !== newHeaders.length;
            if (!headersChanged) { // check further to see if they did change
              var curNames = _.pluck(curHeaders, 'columnName');
              var newNames = _.pluck(curHeaders, 'columnName');

              headersChanged = _.difference(curNames, newNames).length > 0;
            }


            if (headersChanged)
            {
              scope.headers = newHeaders;
              scope.panel.columnSortOrder = [];
            }
          }

          function setTableData() {
            // avoid using angular bindings for table data in order to avoid performance penalty
            // in case user wants to view a large number of cells simultaneously
            scope.tableData = _.reduce(pagedData, function(prev, cur) {
              var row = _.map(cur, function(seriesValue) {
                return '<td>' + seriesValue  + '</td>';
              }).join('');

              row = '<tr>' + row + '</tr>';

              return prev += row;
            }, '');
          }

          function performHeaderPositioning() {
            var realHeaders = elem.find('.real-table-header');
            var fixedHeaders = elem.find('.fixed-table-header');
            var container = elem.find('.table-vis-overflow-container');

            // set width according to option specification
            if (scope.panel.columnWidth === 'auto') {
              realHeaders.width('auto');
            }
            else {
              realHeaders.width(scope.panel.columnWidth);
            }


            for (var i = 0; i < realHeaders.length; ++i) {
              var realEl = realHeaders.eq(i);
              var fixedEl = fixedHeaders.eq(i);

              var borderWidth = parseFloat(realEl.css('borderWidth')) || 0;

              fixedEl.width(realEl.width() + borderWidth);
              fixedEl.css({ left: realEl.position().left, top: container.position().top });
            }

            fixedHeaders.show();
          }

          function setupInitialPaging() {
            numPages = Math.ceil(data.datapoints.length / scope.panel.pageLimit);
            minPage = numPages > 0 ? 1 : 0;

            scope.panel.curTablePage = minPage; // set to first page, since new data has come in
          }

          function handlePaging() {
            dataToSkip = scope.panel.pageLimit * (scope.panel.curTablePage - 1);
            pagedData = sortedData.slice(dataToSkip, scope.panel.pageLimit + dataToSkip);
          }

          function handleSorting() {
            sortedData = [].concat(data.datapoints);
            if (scope.panel.columnSortOrder.length === 0) {
              return;
            }

            sortedData.sort(sortFunction);

            // multi column sorting
            function sortFunction(a, b){
              for (var i = 0; i < scope.panel.columnSortOrder.length; ++i) {
                var columnToSort = scope.panel.columnSortOrder[i]; // take from list of column sort priority
                var columnIndex = _.findIndex(scope.headers, columnToSort); // actual index of column header

                var ascSort = columnToSort.sortType === SortType.asc;
                var temp = compareItems(a[columnIndex], b[columnIndex], ascSort);

                if (temp !== 0) {
                  break;
                }
              }

              return temp;
            }


            function compareItems(itm1, itm2, ascSort) {
              if (itm1 === itm2) {
                return 0;
              }
              else {
                var isConditionMet = ascSort ? itm1 < itm2 : itm1 > itm2;
                return isConditionMet ? -1 : 1;
              }
            }
          }

          function changeSortType(header) {
            var newType = null;

            switch (header.sortType) {
              case SortType.none:
                newType = SortType.asc;
                scope.panel.columnSortOrder.push(header); // we are beginning to sort by header column, so add to array
                break;

              case SortType.asc:
                newType = SortType.desc;
                break;

              case SortType.desc:
                newType = SortType.none;
                // since we are no longer sorting, remove from sort order array
                scope.panel.columnSortOrder = _.filter(scope.panel.columnSortOrder, function(sortedHeader) { return header !== sortedHeader;  } );
                break;
            }

            header.sortType = newType;
          }



          function shouldAbortRender(isHeightSet) {
            if (!data) {
              return true;
            }

            if ($rootScope.fullscreen && !scope.fullscreen) {
              return true;
            }

            if (!isHeightSet) { return true; }

            if (elem.width() === 0) {
              return false;
            }
          }


          function setTableHeightVariable() {
            var docHeight = $(window).height();
            var editscreenHeight = Math.floor(docHeight * 0.6);
            var fullscreenHeight = Math.floor(docHeight * 0.7);

            // editing takes up a lot of space, so it should be set accordingly
            if (scope.editMode) {
              scope.height = editscreenHeight;
            }
            else if (scope.fullscreen) {
              scope.height = fullscreenHeight;
            }
            else {
              scope.height = null; // if in normal dashboard mode
            }

            try {
              tableHeight = scope.height || scope.panel.height || scope.row.height;
              if (_.isString(tableHeight)) {
                tableHeight = parseInt(tableHeight.replace('px', ''), 10);
              }

              tableHeight -= 5; // padding
              tableHeight -= scope.panel.title ? 24 : 9; // subtract panel title bar
              tableHeight -= scope.shouldHidePaginationControl() ? 0 : 57; // subtract paginator height/margin if applicable

              return true;
            } catch(e) { // IE throws errors sometimes
              return false;
            }
          }

        }
      };
    });




  });
