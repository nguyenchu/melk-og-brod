import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const STORAGE_KEY = 'onboarding.v1.completed';
const RED = '#E10A0A';
const CREAM = '#FFF4E8';

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    icon: 'pricetag',
    title: 'Beste tilbud fra alle kjeder',
    body: 'Vi henter kampanjer og prisfall fra alle kjeder hver dag. Filtrer på kjede, eller se alt.',
  },
  {
    icon: 'cart',
    title: 'Smart handleliste',
    body: 'Søk eller skriv inn varer manuelt. 3-for-2-kampanjer regnes ut automatisk på tvers av varer.',
  },
  {
    icon: 'star',
    title: 'Lagre favorittene dine',
    body: 'Marker varer du kjøper ofte med stjerne. De ligger klare øverst i handlelista.',
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { width } = Dimensions.get('window');
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const isLast = page === SLIDES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  const onNext = () => {
    if (isLast) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.skip} onPress={onDone} hitSlop={12}>
        <Text style={styles.skipText}>Hopp over</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.scroll}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <View style={styles.iconWrap}>
              <Ionicons name={slide.icon} size={88} color={RED} />
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Pressable style={styles.cta} onPress={onNext}>
          <Text style={styles.ctaText}>{isLast ? 'Kom i gang' : 'Neste'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function useOnboarding(): { needsOnboarding: boolean; markDone: () => void } {
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        setNeedsOnboarding(v == null);
        setResolved(true);
      })
      .catch(() => setResolved(true));
  }, []);

  const markDone = () => {
    setNeedsOnboarding(false);
    AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
  };

  return { needsOnboarding: resolved ? needsOnboarding : false, markDone };
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CREAM,
    zIndex: 1000,
  },
  scroll: { flex: 1 },
  slide: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: {
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 36,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  skip: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  skipText: { fontSize: 14, color: '#888', fontWeight: '600' },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 48,
    paddingTop: 12,
    gap: 24,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ddd',
  },
  dotActive: { backgroundColor: RED, width: 24 },
  cta: {
    backgroundColor: RED,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
