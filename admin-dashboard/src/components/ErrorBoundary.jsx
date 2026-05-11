import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 flex flex-col items-center justify-center min-h-[40vh]">
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 max-w-md text-center">
            <div className="text-lg font-semibold text-rose-800 mb-2">Something went wrong</div>
            <div className="text-sm text-rose-600 mb-4">{this.state.error?.message || 'An unexpected error occurred.'}</div>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="px-4 py-2 text-sm bg-rose-600 text-white rounded hover:bg-rose-700">
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
