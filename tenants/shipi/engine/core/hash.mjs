import {createHash} from 'node:crypto';
// Content hash shared by the search engine; kept dependency-free so the engine can run without the crawling stack.
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
