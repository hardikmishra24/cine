import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'An unexpected workspace error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('CineForge ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0B0D] text-[#F4F4F6] flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-[#16171D] border border-[#262933] rounded-xl p-8 space-y-5">
            <div className="flex items-center gap-3 text-[#EF4444]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold text-[#F4F4F6]">Workspace Recovery Required</h2>
            </div>
            <p className="text-sm text-[#989CA8] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
