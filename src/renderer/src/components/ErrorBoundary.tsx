import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useI18n, type TFunction } from "../i18n";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface BoundaryProps extends Props {
  t: TFunction;
}

class ErrorBoundaryImpl extends Component<BoundaryProps, State> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h2 className="error-boundary-title">
              {this.props.t("errorBoundary.title")}
            </h2>
            <p className="error-boundary-message">
              {this.state.error?.message ||
                this.props.t("errorBoundary.message")}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              {this.props.t("errorBoundary.tryAgain")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ErrorBoundary(props: Props): React.JSX.Element {
  const { t } = useI18n();
  return <ErrorBoundaryImpl {...props} t={t} />;
}

export default ErrorBoundary;
