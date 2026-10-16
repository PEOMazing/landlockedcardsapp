// pk-v6: kept only so an older import of this path still resolves. The rule
// itself moved into lib/calc, which every caller already imports - a new file
// that fails to upload takes the whole build down with module_not_found, and
// that happened twice.
export { packingFeeToStamp, type FeeStampInput } from "./calc";
