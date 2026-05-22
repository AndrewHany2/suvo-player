import { TamaguiProvider } from 'tamagui';
import { tamaguiConfig } from './src/tamagui.config';
import { AppProvider } from './src/context/AppContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <TamaguiProvider config={tamaguiConfig}>
      <AppProvider>
        <AppNavigator />
      </AppProvider>
    </TamaguiProvider>
  );
}
