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
import ClarityLogin from './login/skins/ClarityLogin';
export default function Login() {
  const [mode, setMode] = useState(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const skin = skinForTheme(mode);
  // No skins.ts registry by design: skinForTheme() + the switch below is the
  // routing (covered by theme-registry + skin R1 tests).
  return (
    <>
      <LoginThemeMenu />
      {skin === 'paper' ? <PaperLogin />
      : skin === 'console' ? <ConsoleLogin />
      : skin === 'bold' ? <BoldLogin />
      : skin === 'shell' ? <ShellLogin />
      : skin === 'terminal' ? <TerminalLogin />
      : skin === 'clarity' ? <ClarityLogin />
      : <LegacyLogin />}
    </>
  );
}
