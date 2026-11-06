// One error boundary per tab: an error while a tab renders stops that tab only. The top bar and the other tabs keep
// working, and "Try again" draws the tab fresh, with no page reload.
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { Rubber } from "./ui";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null; tries: number };

export default class TabBoundary extends Component<Props, State> {
  state: State = { error: null, tries: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`The ${this.props.name} tab stopped:`, error, info.componentStack);
  }

  render() {
    const { error, tries } = this.state;
    if (!error) return <Fragment key={tries}>{this.props.children}</Fragment>; // a new key after "Try again": the tab starts fresh
    return (
      <section className="section" style={{ marginTop: 26 }}>
        <div className="seal bad">
          <Rubber good={false}>Stopped</Rubber>
          <div>
            <div className="big">The {this.props.name} tab hit an error</div>
            <div className="muted mono" style={{ marginTop: 6 }}>
              {error.message.slice(0, 200) || "unknown error"}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              The other tabs keep working. Try again draws this tab fresh, without reloading the page.
            </div>
            <div className="cta-row" style={{ marginTop: 14 }}>
              <button className="cta" onClick={() => this.setState({ error: null, tries: tries + 1 })}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }
}
