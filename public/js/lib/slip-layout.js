/**
 * Number grids laid out like the PCSO bet slip for each game:
 *   6/42, 6/45, 6/49  rows of 9, left to right:  1 2 3 ... 9 / 10 11 ... 18 / ...
 *   6/55, 6/58        columns of 10, top to bottom: 1-10 down the first column, 11-20 the next, ...
 * The numbers are still added to the grid in order 1, 2, 3...; CSS grid flow places them,
 * so keyboard and screen-reader order stays 1 to N.
 */

const ROW_SLIP_COLUMNS = 9;
const COLUMN_SLIP_ROWS = 10;
const COLUMN_SLIP_FROM = 55; // 6/55 and 6/58 use the top-to-bottom slip

/** @returns {{ flow: 'row'|'column', columns: number, rows: number }} */
export function slipLayout(maxNumber) {
  if (maxNumber >= COLUMN_SLIP_FROM) {
    return { flow: 'column', columns: Math.ceil(maxNumber / COLUMN_SLIP_ROWS), rows: COLUMN_SLIP_ROWS };
  }
  return { flow: 'row', columns: ROW_SLIP_COLUMNS, rows: Math.ceil(maxNumber / ROW_SLIP_COLUMNS) };
}

/** Applies the game's slip layout to a .number-picker element. */
export function applySlipLayout(grid, maxNumber) {
  const layout = slipLayout(maxNumber);
  grid.classList.add('number-picker--slip');
  grid.dataset.flow = layout.flow;
  grid.style.setProperty('--slip-columns', String(layout.columns));
  grid.style.setProperty('--slip-rows', String(layout.rows));
}
