/* global React */
// Scrubber — <input type=range> styled to match the product. 0..1000 step 1.
function Scrubber({ value, onChange, onSeek }) {
  const [scrubbing, setScrubbing] = React.useState(false);
  return (
    <input
      type="range"
      className="tt-scrubber"
      min="0" max="1000" step="1"
      value={value}
      onChange={(e) => onChange && onChange(Number(e.target.value))}
      onMouseDown={() => setScrubbing(true)}
      onMouseUp={(e) => { setScrubbing(false); onSeek && onSeek(Number(e.target.value)); }}
    />
  );
}
window.Scrubber = Scrubber;
