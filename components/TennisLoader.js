import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

const WORD = "TACHERTING";
const WORD_WIDTH = 220;

/**
 * Shared full-screen loading state for Tennis Tacherting.
 * Fast loads stay visually quiet; longer loads show only the wordmark,
 * filling softly from muted blue to orange.
 */
export default function TennisLoader({ style }) {
  const [visible, setVisible] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;

    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fill, {
          toValue: 1,
          duration: 980,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.delay(140),
        Animated.timing(fill, {
          toValue: 0,
          duration: 0,
          useNativeDriver: false,
        }),
        Animated.delay(120),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [enter, fill, visible]);

  if (!visible) return <View style={[styles.root, style]} />;

  const fillWidth = fill.interpolate({
    inputRange: [0, 1],
    outputRange: [0, WORD_WIDTH],
  });

  return (
    <View style={[styles.root, style]} pointerEvents="none">
      <Animated.View
        style={{
          opacity: enter,
          transform: [
            {
              scale: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [0.985, 1],
              }),
            },
          ],
        }}
      >
        <View style={styles.wordClip}>
          <Text style={[styles.word, styles.wordBase]}>{WORD}</Text>
          <Animated.View style={[styles.fillClip, { width: fillWidth }]}> 
            <Text style={[styles.word, styles.wordActive]}>{WORD}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#001738",
  },
  wordClip: {
    width: WORD_WIDTH,
    height: 34,
    position: "relative",
    overflow: "hidden",
  },
  word: {
    position: "absolute",
    left: 0,
    top: 0,
    width: WORD_WIDTH,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: 4.4,
    textAlign: "center",
  },
  wordBase: {
    color: "rgba(155, 181, 211, 0.22)",
  },
  fillClip: {
    position: "absolute",
    left: 0,
    top: 0,
    height: 34,
    overflow: "hidden",
  },
  wordActive: {
    color: "#F28B25",
  },
});
