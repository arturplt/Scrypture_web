/** Where leaving the world screen goes: Home when the world was opened from the plane button there, else the list of worlds. */
let fromHome = false;
export const enterWorldFromHome = (v: boolean) => { fromHome = v; };
export const worldExitPath = () => (fromHome ? '/' : '/games/paperplane');
