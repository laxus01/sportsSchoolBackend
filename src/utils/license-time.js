export function computeOfflineUntil(graceUntil, issuedAt, offlineDays = 30) {
  const grace = new Date(graceUntil);
  const issued = new Date(issuedAt);
  if (Number.isNaN(grace.valueOf()) || Number.isNaN(issued.valueOf())) {
    throw new TypeError('Invalid license time');
  }
  const maximumOffline = new Date(
    issued.valueOf() + offlineDays * 24 * 60 * 60 * 1000,
  );
  return grace.valueOf() <= maximumOffline.valueOf()
    ? grace
    : maximumOffline;
}
