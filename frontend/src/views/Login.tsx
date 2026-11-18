import { useEffect, useState } from 'react';
import { getThemeMode, onThemeChanged } from '@/lib/theme';
import { skinForTheme } from '@/lib/theme-registry';
import LegacyLogin from './login/skins/LegacyLogin';
import PaperLogin from './login/skins/PaperLogin';
import ConsoleLogin from './login/skins/ConsoleLogin';
import BoldLogin from './login/skins/BoldLogin';
import ShellLogin from './login/skins/ShellLogin';
import TerminalLogin from './login/skins/TerminalLogin';
export default function Login() {
  const [mode, setMode] = useState(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const skin = skinForTheme(mode);
  if (skin === 'paper') return <PaperLogin />;
  if (skin === 'console') return <ConsoleLogin />;
  if (skin === 'bold') return <BoldLogin />;
  if (skin === 'shell') return <ShellLogin />;
  if (skin === 'terminal') return <TerminalLogin />;
  return <LegacyLogin />;
}
