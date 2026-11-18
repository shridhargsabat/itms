import { useEffect, useState } from 'react';
import { getThemeMode, onThemeChanged } from '@/lib/theme';
import { skinForTheme } from '@/lib/theme-registry';
import LegacyLogin from './login/skins/LegacyLogin';
import PaperLogin from './login/skins/PaperLogin';
export default function Login() {
  const [mode, setMode] = useState(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const skin = skinForTheme(mode);
  if (skin === 'paper') return <PaperLogin />;
  return <LegacyLogin />;
}
