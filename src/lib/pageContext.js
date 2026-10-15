import { createContext } from 'react';

// True inside a page (a tab or split pane) that shows what used to be a pop-up: the Modal then renders in place instead of as an overlay.
export const PageContext = createContext(false);
