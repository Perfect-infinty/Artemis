import React from 'react';

/**
 * Catches render errors below it so one broken message or pane does not blank the whole window.
 * fallback: a node, or a function (error, reset) => node. resetKey: when it changes, the boundary tries again.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; this.reset = () => this.setState({ error: null }); }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try { console.error('[ErrorBoundary]', this.props.name || '', error, info && info.componentStack); } catch {}
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const fb = this.props.fallback;
    if (typeof fb === 'function') return fb(error, this.reset);
    if (fb !== undefined) return fb;
    return (
      <div className="crash-card" role="alert">
        <div className="crash-title">Something went wrong{this.props.name ? ` in ${this.props.name}` : ''}.</div>
        <div className="crash-msg">{String((error && error.message) || error)}</div>
        <button type="button" onClick={this.reset}>Try again</button>
      </div>
    );
  }
}
