/* global React */
// IconButton — 28px round, three variants: default / play (32px, blue wash) / close (22px, danger hover)
function IconButton({ variant = 'default', title, onClick, children }) {
  return (
    <button className={`tt-iconbtn tt-iconbtn--${variant}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
window.IconButton = IconButton;
