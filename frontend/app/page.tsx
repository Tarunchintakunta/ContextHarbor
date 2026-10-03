import SiteHeader from "./SiteHeader";
import ApiStatus from "./status";

function Slide({ withCue }: { withCue: boolean }) {
  return (
    <div className="monitor">
      <div className="slide">
        <h3>Payments migration: Q4 plan</h3>
        <div className="bars" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="tiles" aria-hidden="true"><b /><b /><b /></div>
        <p className="caption"><strong>Priya:</strong> <span className="typed">Varish, when does the payments migration launch?</span></p>
        {withCue && (
          <div className="cue" role="img" aria-label="Private answer card: launch is October 14, starting with Ireland and the Netherlands. Source: payments-plan, 30 September.">
            <em>Only on your screen</em>
            <p>Launch is October 14, starting with Ireland and the Netherlands.</p>
            <small>payments-plan, 30 Sep</small>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="wrap">
      <SiteHeader />

      <main>
        <section className="hero">
          <h1>Asked on the spot? Your notes have the answer.</h1>
          <p>
            ContextHarbor listens to your meeting on your own computer. When someone asks you a question, it finds the answer in your notes
            and shows it on a small card that the rest of the call doesn&apos;t see.
          </p>
        </section>

        <div className="screens">
          <figure className="screen">
            <figcaption>What they see <span>on your shared screen</span></figcaption>
            <Slide withCue={false} />
          </figure>
          <figure className="screen">
            <figcaption>What you see <span>on your own display</span></figcaption>
            <Slide withCue />
          </figure>
        </div>
        <p className="note">
          Tested on macOS: the card was left out of screen captures. Results vary by meeting app and operating system, so the support
          table below shows what is checked.
        </p>

        <section className="block">
          <h2>One question, about two seconds</h2>
          <p className="lede">Timings from a recorded run on a MacBook Pro, with a local model and no internet calls.</p>
          <ol className="moment">
            <li>
              <time>0.0 s</time>
              <div><h3>Priya finishes asking</h3><p>Speech is transcribed on your computer. Your name tells the app the question is for you.</p></div>
            </li>
            <li>
              <time>+0.03 s</time>
              <div><h3>Your notes are searched</h3><p>Only your own notes, sorted into week folders. The newer plan wins over the outdated one.</p></div>
            </li>
            <li>
              <time>+0.7 s</time>
              <div><h3>The answer starts to appear</h3><p>One to three short points, written so you can glance and say them in your own words.</p></div>
            </li>
            <li>
              <time>+1.6 s</time>
              <div><h3>Done, with the source</h3><p>The file name and date sit under the answer, so you know where it came from.</p></div>
            </li>
          </ol>
        </section>

        <section className="block">
          <h2>Your notes stay yours</h2>
          <div className="promises">
            <div><h3>One person, one set of notes</h3><p>Each search only looks at the signed-in person&apos;s notes. Switching people clears everything first.</p></div>
            <div><h3>Kept on your computer</h3><p>Transcripts and history are encrypted on disk. Raw audio and screen images are never saved.</p></div>
            <div><h3>Nothing recorded without permission</h3><p>Recording stays off until your organisation&apos;s policy and consent are set. Exams and interviews are skipped.</p></div>
            <div><h3>It says when it doesn&apos;t know</h3><p>If your notes don&apos;t cover the question, the card says so instead of guessing.</p></div>
          </div>
        </section>

        <section className="block">
          <h2>Where the card stays private</h2>
          <p className="lede">No screen-sharing tool can be guaranteed to skip a window. Here is what each system supports today and what the app does when it can&apos;t.</p>
          <div className="scroll">
            <table className="table">
              <thead><tr><th>System</th><th>Hidden from screen capture</th><th>While you present</th></tr></thead>
              <tbody>
                <tr><td>macOS</td><td><span className="state ok">Passed local capture tests</span>. Not yet checked from another participant&apos;s view.</td><td>The card moves to your second display, or stays hidden on a single display until you confirm it.</td></tr>
                <tr><td>Windows 10 and 11</td><td><span className="state warn">Supported by Windows</span>, not yet tested.</td><td>The card stays on your screen.</td></tr>
                <tr><td>Linux</td><td><span className="state bad">Not supported</span></td><td>The card hides while you present on a single display.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer>
        <span>ContextHarbor is in development. The desktop app runs with local models today. <ApiStatus /></span>
        <a href="https://github.com/Tarunchintakunta/ContextHarbor">Source on GitHub</a>
      </footer>
    </div>
  );
}
