import { useEffect, useState } from 'react';
import { getThemeMode, onThemeChanged } from '@/lib/theme';
import { skinForTheme } from '@/lib/theme-registry';
import LoginThemeMenu from '@/components/LoginThemeMenu';
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
  return (
    <>
      <LoginThemeMenu />
      {skin === 'paper' ? <PaperLogin />
      : skin === 'console' ? <ConsoleLogin />
      : skin === 'bold' ? <BoldLogin />
      : skin === 'shell' ? <ShellLogin />
      : skin === 'terminal' ? <TerminalLogin />
      : <LegacyLogin />}
    </>
  );
}
