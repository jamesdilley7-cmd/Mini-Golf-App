import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
}
interface State {
  errorId: number; // >0 while showing the fallback
  recentFailures: number;
}

/**
 * Recovers from transient render/teardown errors instead of letting them crash
 * the whole app. In particular react-three-fiber can throw during the GL
 * `<Canvas>` teardown on native ("Cannot delete property '__r3f' of
 * undefined") when navigating away from the game — that error is thrown while
 * the offending tree is already unmounting, so on the next render it's gone and
 * simply re-rendering recovers cleanly.
 *
 * We auto-retry once per error. If errors keep firing in a tight window (a
 * genuinely persistent problem rather than a one-off teardown), we stop
 * auto-retrying and show a tap-to-continue fallback so we never spin in a
 * render loop.
 */
export default class AppErrorBoundary extends React.Component<Props, State> {
  private lastFailureAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  state: State = { errorId: 0, recentFailures: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { errorId: Date.now() };
  }

  componentDidCatch(error: Error) {
    const now = Date.now();
    const rapid = now - this.lastFailureAt < 2000;
    this.lastFailureAt = now;
    const recentFailures = rapid ? this.state.recentFailures + 1 : 1;
    // eslint-disable-next-line no-console
    console.warn('[AppErrorBoundary] recovered from error:', error?.message);
    this.setState({ recentFailures });
    // Auto-retry a one-off (e.g. Canvas teardown). Bail out to a manual
    // fallback if we're clearly looping.
    if (recentFailures <= 3) {
      this.retryTimer = setTimeout(() => this.setState({ errorId: 0 }), 0);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private reset = () => {
    this.setState({ errorId: 0, recentFailures: 0 });
  };

  render() {
    if (this.state.errorId !== 0 && this.state.recentFailures > 3) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Tap to continue</Text>
          </Pressable>
        </View>
      );
    }
    // While auto-retrying (errorId set, failures <= 3) render nothing for a
    // frame; the scheduled setState clears it immediately.
    if (this.state.errorId !== 0) return <View style={styles.blank} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F3D24', padding: 24 },
  blank: { flex: 1, backgroundColor: '#0F3D24' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  button: { backgroundColor: '#1F6F4A', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
