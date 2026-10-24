const wholePeso = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const wholeNumber = new Intl.NumberFormat('en-US');

/** 430857884.28 -> "₱430,857,884" */
export function formatPeso(amount) {
  return `₱${wholePeso.format(Math.round(Number(amount)))}`;
}

export function formatNumber(value) {
  return wholeNumber.format(value);
}

/** 7 -> "07" */
export function pad2(number) {
  return String(number).padStart(2, '0');
}

/** Exact number of 6-number combinations for numbers 1..maxNumber. */
export function totalCombinations(maxNumber) {
  let result = 1;
  for (let index = 0; index < 6; index += 1) {
    result = (result * (maxNumber - index)) / (index + 1);
  }
  return Math.round(result);
}
