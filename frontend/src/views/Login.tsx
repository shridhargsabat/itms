import { useEffect, useState } from 'react';
import { getThemeMode, onThemeChanged } from '@/lib/theme';
import { skinForTheme } from '@/lib/theme-registry';
import LegacyLogin from './login/skins/LegacyLogin';
export default function Login() {
  const [mode, setMode] = useState(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const skin = skinForTheme(mode);
  if (skin === 'paper') return <LegacyLogin />; // Task 7 swaps to PaperLogin
  return <LegacyLogin />;
}
