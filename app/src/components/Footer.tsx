import { href } from "../router";

export const SOURCE_URL = "https://github.com/druzn3k/swarm";

export function Credit() {
  return (
    <>
      Unofficial fork of <a href="https://www.swarmsim.com">Swarm Simulator</a> by Evan Rosson.{" "}
      <a href="https://www.gnu.org/licenses/gpl-3.0.html">GPLv3</a>. Source code: <a href={SOURCE_URL}>{SOURCE_URL}</a>
    </>
  );
}

export function Footer() {
  return (
    <footer className="app-footer">
      <p>
        <Credit />
      </p>
      <p>
        <a href={href({ name: "about" })}>About</a>
      </p>
    </footer>
  );
}
