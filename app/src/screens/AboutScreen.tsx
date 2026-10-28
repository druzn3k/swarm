// PHASE B (B2) may expand this; the credit line must stay.
import { Credit, SOURCE_URL } from "../components/Footer";

export function AboutScreen() {
  return (
    <section className="page" aria-labelledby="page-title">
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
    </section>
  );
}
