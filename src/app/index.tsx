import { StyleSheet, Text, View } from 'react-native';

// Tela mínima de verificação da T1.1. O Design System real será criado na T1.2.
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Finanças</Text>
      <Text style={styles.subtitle}>Fundação do projeto (T1.1)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D10',
    padding: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8E95A2',
    fontSize: 16,
    marginTop: 8,
  },
});

