/**
 * @license
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
goog.provide('lf.DiffCalculator');

goog.require('goog.math');
goog.require('lf.eval.Type');
goog.require('lf.service');



/**
 * A DiffCalculator is responsible for detecting and applying the difference
 * between old and new results for a given query.
 * @constructor
 *
 * @param {!lf.Global} global
 * @param {!lf.query.SelectContext} query
 * @param {!Array<?>} observableResults The array holding the last results. This
 *     is the array that is directly being observed by observers.
 */
lf.DiffCalculator = function(global, query, observableResults) {
  /** @private {!lf.eval.Registry} */
  this.evalRegistry_ = global.getService(lf.service.EVAL_REGISTRY);

  /** @private {!lf.query.SelectContext} */
  this.query_ = query;

  /** @private {!Array<?>} */
  this.observableResults_ = observableResults;

  /** @private {!Array<!lf.schema.Column>} */
  this.columns_ = this.detectColumns_();
};


/**
 * Detects the columns present in each result entry.
 * @return {!Array<!lf.schema.Column>}
 * @private
 */
lf.DiffCalculator.prototype.detectColumns_ = function() {
  if (this.query_.columns.length > 0) {
    return this.query_.columns;
  } else {
    // Handle the case where all columns are being projected.
    var columns = [];
    var tables = this.query_.from.slice();
    if (goog.isDefAndNotNull(this.query_.innerJoin)) {
      tables.push(this.query_.innerJoin);
    }
    tables.forEach(function(table) {
      table.getColumns().forEach(function(column) {
        columns.push(column);
      });
    });

    return columns;
  }
};


/**
 * The comparator function to use for determining whether two entries are the
 * same.
 * @param {!lf.proc.RelationEntry} left
 * @param {!lf.proc.RelationEntry} right
 * @return {boolean} Whether the two entries are identical, taking only into
 *     account the columns that are being projected.
 * @private
 */
lf.DiffCalculator.prototype.comparator_ = function(
    left, right) {
  return this.columns_.every(function(column) {
    var evalFn = this.evalRegistry_.getEvaluator(
        column.getType(), lf.eval.Type.EQ);
    return evalFn(left.getField(column), right.getField(column));
  }, this);
};


/**
 * Detects the diff between old and new results, and applies it to the
 * observed array, which triggers observers to be notified.
 * @param {?lf.proc.Relation} oldResults
 * @param {!lf.proc.Relation} newResults
 *
 * TODO(dpapad): Modify this logic to properly detect modifications. Currently
 * a modification is detected as a deletion and an insertion.
 * Also currently the implementation below is calculating
 * longestCommonSubsequence twice, with different collectorFn each time, because
 * comparisons are done based on object reference, there might be a cheaper way,
 * such that longestCommonSubsequence is only called once.
 */
lf.DiffCalculator.prototype.applyDiff = function(oldResults, newResults) {
  var oldEntries = goog.isNull(oldResults) ? [] : oldResults.entries;

  // Detecting and applying deletions.
  var longestCommonSubsequenceLeft = goog.math.longestCommonSubsequence(
      oldEntries, newResults.entries,
      goog.bind(this.comparator_, this),
      function(indexLeft, indexRight) {
        return oldEntries[indexLeft];
      });

  var commonIndex = 0;
  for (var i = 0; i < oldEntries.length; i++) {
    var entry = oldEntries[i];
    if (longestCommonSubsequenceLeft[commonIndex] == entry) {
      commonIndex++;
      continue;
    } else {
      this.observableResults_.splice(i, 1);
    }
  }

  // Detecting and applying additions.
  var longestCommonSubsequenceRight = goog.math.longestCommonSubsequence(
      oldEntries, newResults.entries,
      goog.bind(this.comparator_, this),
      function(indexLeft, indexRight) {
        return newResults.entries[indexRight];
      });

  commonIndex = 0;
  for (var i = 0; i < newResults.entries.length; i++) {
    var entry = newResults.entries[i];
    if (longestCommonSubsequenceRight[commonIndex] == entry) {
      commonIndex++;
      continue;
    } else {
      this.observableResults_.splice(i, 0, entry.row.payload());
    }
  }
};