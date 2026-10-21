import {createHash} from 'node:crypto';

export const hasTrackingEventId = document => typeof document.event_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(document.event_id);
// A stable Mongo _id makes retries atomic without adding an index to legacy data.
// Separate cart actions have separate event IDs, even in the same session.
export async function insertTrackingEvent(collection, document) {
  const data = hasTrackingEventId(document)
    ? {...document, _id: 'sx-' + createHash('sha256').update(String(document.event_type) + ':' + document.event_id).digest('hex')}
    : document;
  try { return {duplicate: false, ...await collection.insertOne(data)}; }
  catch (error) { if (hasTrackingEventId(document) && error.code === 11000) return {duplicate: true}; throw error; }
}
