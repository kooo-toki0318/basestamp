export function HomePage() {
  return (
    <>
      <section className="shell hero">
        <div>
          <p className="eyebrow">Private by design · verifiable on Base</p>
          <h1>Record that a file existed. Keep the file to yourself.</h1>
          <p className="lede">
            BaseStamp creates a salted commitment in a dedicated browser worker,
            records only public values on Base, and lets you verify the same file
            locally.
          </p>
          <div className="actions">
            <a className="button-link" href="/create">
              Create a record
            </a>
            <a className="button-link secondary" href="/verify">
              Verify a handoff
            </a>
          </div>
        </div>

        <aside className="preview" aria-label="How BaseStamp works">
          <span className="preview-label">Base Sepolia live</span>
          <h2>Local-first verification</h2>
          <ol>
            <li><span>01</span> File stays in your browser</li>
            <li><span>02</span> Commitment is recorded on Base</li>
            <li><span>03</span> The same file is checked locally</li>
          </ol>
          <p>
            BaseStamp is not notarization, identity verification, copyright
            registration, or a guarantee of legal effect.
          </p>
        </aside>
      </section>
      <section className="handoff-story" aria-labelledby="handoff-heading">
        <div className="shell">
          <div className="section-heading">
            <p className="eyebrow">A simple sender-to-recipient handoff</p>
            <h2 id="handoff-heading">Record once. Verify anywhere.</h2>
            <p>
              BaseStamp turns a local file check into a small, portable handoff.
              The original file never needs to be uploaded to us.
            </p>
          </div>

          <ol className="handoff-steps">
            <li>
              <span className="flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M7 3.75h7l3 3V20.25H7z" />
                  <path d="M14 3.75v3h3M9.5 12h5M9.5 15h3.5" />
                </svg>
              </span>
              <span className="step-number">01</span>
              <h3>Choose and sign</h3>
              <p>
                Select a file, connect your wallet, and sign the transaction
                that records its private fingerprint.
              </p>
            </li>
            <li>
              <span className="flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3.75v10.5M8.5 11l3.5 3.5 3.5-3.5" />
                  <path d="M5.5 16.75v3.5h13v-3.5" />
                </svg>
              </span>
              <span className="step-number">02</span>
              <h3>Save the JSON</h3>
              <p>
                Download the verification package created after the onchain
                record is confirmed.
              </p>
            </li>
            <li>
              <span className="flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="m4 11.25 16-7-6.5 15-2.25-6z" />
                  <path d="m11.25 13.25 4.75-5" />
                </svg>
              </span>
              <span className="step-number">03</span>
              <h3>Send the bundle</h3>
              <p>
                Share the original file, its JSON, and the Verify link by email,
                cloud storage, or chat.
              </p>
            </li>
            <li>
              <span className="flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3.5 19 6v5.25c0 4.15-2.75 7.55-7 9.25-4.25-1.7-7-5.1-7-9.25V6z" />
                  <path d="m8.75 12 2.1 2.1 4.5-4.7" />
                </svg>
              </span>
              <span className="step-number">04</span>
              <h3>Recipient verifies</h3>
              <p>
                They select the received JSON and file. BaseStamp checks both
                locally and onchain—no wallet required.
              </p>
            </li>
          </ol>

          <div className="handoff-cta">
            <p>Received a BaseStamp package with a file?</p>
            <a className="button-link" href="/verify">
              Verify a received file
            </a>
          </div>
        </div>
      </section>

      <section className="shell use-cases" aria-labelledby="use-cases-heading">
        <div className="section-heading compact-heading">
          <p className="eyebrow">Practical use cases</p>
          <h2 id="use-cases-heading">Useful whenever the exact file matters.</h2>
        </div>
        <div className="use-case-grid">
          <article>
            <span aria-hidden="true">01</span>
            <h3>Creative handoff</h3>
            <p>
              Deliver a design, photo, audio master, or draft with a reproducible
              way to check that it has not changed.
            </p>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>Document delivery</h3>
            <p>
              Pair a report, agreement draft, or certificate with evidence that
              the recipient has the exact recorded file.
            </p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>Release evidence</h3>
            <p>
              Record a build, dataset, research output, or publication before
              distribution so collaborators can verify the version later.
            </p>
          </article>
        </div>
        <p className="proof-boundary">
          BaseStamp verifies a file match and its onchain record. It does not by
          itself prove authorship, ownership, identity, or legal validity.
        </p>
      </section>


      <section className="shell principles">
        <article>
          <p className="number">01</p>
          <h2>No upload</h2>
          <p>
            There is no file upload endpoint. File bytes are read only inside a
            dedicated browser worker.
          </p>
        </article>
        <article>
          <p className="number">02</p>
          <h2>Minimal public record</h2>
          <p>
            Only creator, time, salted commitment, and fixed metadata hash are
            stored in the ownerless Registry.
          </p>
        </article>
        <article>
          <p className="number">03</p>
          <h2>Portable proof material</h2>
          <p>
            Save a local verification package containing the salt and transaction
            references required for later comparison.
          </p>
        </article>
      </section>
    </>
  );
}
