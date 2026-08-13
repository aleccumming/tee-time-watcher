export const SITES = {
  vancouver: {
    label: 'Vancouver',
    host: 'golfvancouver.cps.golf',
    bookingUrl: 'https://golfvancouver.cps.golf/onlineresweb/search-teetime',
    courses: {
      1: 'Langara Golf Course',
      2: 'Fraserview Golf Course',
      3: 'McCleery Golf Course',
    },
  },
  burnaby: {
    label: 'Burnaby',
    host: 'golfburnaby.cps.golf',
    bookingUrl: 'https://golfburnaby.cps.golf/onlineresweb/search-teetime',
    courses: {
      1: 'Burnaby Mountain Golf',
      2: 'Riverway Golf',
    },
  },
};

export function findCourse(siteKey, courseNameOrId) {
  const site = SITES[siteKey];
  if (!site) return null;
  const idMatch = Number(courseNameOrId);
  if (Number.isInteger(idMatch) && site.courses[idMatch]) {
    return { id: idMatch, name: site.courses[idMatch] };
  }
  const lower = String(courseNameOrId).toLowerCase();
  for (const [id, name] of Object.entries(site.courses)) {
    if (name.toLowerCase().includes(lower)) return { id: Number(id), name };
  }
  return null;
}
