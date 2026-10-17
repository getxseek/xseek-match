/** Letters that tuck away after the x and after the m. */
const AFTER_X = [...'seek '];
const AFTER_M = [...'atch'];

function tuckedLetters(letters: string[], accent: boolean) {
  return letters.map((letter, index) => (
    <span key={index} className={accent ? 'xm-tuck xm-accent' : 'xm-tuck'}>
      {letter}
    </span>
  ));
}

/**
 * "xseek match" that collapses into the xm mark: the other letters slide back behind the x and
 * the m while the two close up. Reduced motion shows xm directly.
 */
export function XmCollapseMark({ className }: { className: string }) {
  return (
    <div className={`xm-collapse ${className}`} aria-hidden="true">
      <span className="xm-x">x</span>
      {tuckedLetters(AFTER_X, false)}
      <span className="xm-accent">m</span>
      {tuckedLetters(AFTER_M, true)}
    </div>
  );
}
