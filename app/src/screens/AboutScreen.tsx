// The about screen: credits, license and source. The credit line must stay.
import { Credit, SOURCE_URL } from "../components/Footer";
import "../styles/meta.css";

export const ORIGINAL_URL = "https://github.com/swarmsim/swarm";
export const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";

export function AboutScreen() {
  return (
    <section className="page about" aria-labelledby="page-title">
      <h1 id="page-title">About</h1>
      <div className="section card">
        <p>
          <Credit />
        </p>
        <p>
          Swarm Hive is a phone-first, pixel-art take on Swarm Simulator, running the original game's rules. Your progress saves in this
          browser.
        </p>
        <p>
          Found a problem? <a href={`${SOURCE_URL}/issues`}>Report it on GitHub</a>.
        </p>
      </div>

      <section className="section card" aria-labelledby="about-credits">
        <h2 id="about-credits">Credits</h2>
        <p>
          <b>Swarm Simulator</b> was created by Evan Rosson. Its game design, numbers and text are his; this app plays by the same rules.
        </p>
        <p>
          Original game: <a href="https://www.swarmsim.com">swarmsim.com</a>
          <br />
          Original source: <a href={ORIGINAL_URL}>{ORIGINAL_URL}</a>
        </p>
      </section>

      <section className="section card" aria-labelledby="about-fork">
        <h2 id="about-fork">This fork</h2>
        <p>
          Swarm Hive keeps the original game's engine, ported to TypeScript and checked against the original number for number, and puts a new
          interface on top: one column, big touch targets, pixel art drawn in code. Saves use the original format, so you can bring a
          swarmsim.com save over (Options, Import) and take it back.
        </p>
        <p>
          Source code: <a href={SOURCE_URL}>{SOURCE_URL}</a>
        </p>
      </section>

      <section className="section card" aria-labelledby="about-license">
        <h2 id="about-license">License</h2>
        <p>
          Swarm Hive is free software, released under the{" "}
          <a href={LICENSE_URL}>GNU General Public License, version 3</a> (GPLv3), like the original game. You may share and change it under
          the same terms. It comes with no warranty.
        </p>
      </section>
    </section>
  );
}
