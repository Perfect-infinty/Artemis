// Open note editors register a function that saves their unsaved text, so a rename, move or delete can wait for it.
const savers = new Set();
export const registerNoteFlush = (fn) => { savers.add(fn); return () => savers.delete(fn); };
export const flushAllNotes = () => Promise.all([...savers].map((f) => f()));
