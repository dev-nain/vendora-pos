import { useCallback, useEffect, useRef, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { serviceErrorMessage } from "../auth/messages";
import type { LeaveGuard } from "../purchasing/order-form-screen";
import { SellArea } from "../shifts/sell-area";
import { BackOffice } from "./back-office";
import { HintBar, type Hint } from "./hint-bar";
import { TitleBar, type Area } from "./title-bar";

interface AppShellProps {
  user: SafeUser;
  onSwitchUser: () => void;
  onLoggedOut: () => void;
}

const backOfficeHints: Hint[] = [
  ["Ctrl+1", "Sell"],
  ["Ctrl+L", "Switch user"],
];

export function AppShell({ user, onSwitchUser, onLoggedOut }: AppShellProps) {
  const [error, setError] = useState<string | null>(null);
  const [area, setAreaState] = useState<Area>("sell");
  const [printerFocus, setPrinterFocus] = useState(false);
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const [sellHints, setSellHints] = useState<Hint[]>([["Ctrl+L", "Switch user"]]);

  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    leaveGuard.current = guard;
  }, []);

  const guarded = useCallback((go: () => void) => {
    if (leaveGuard.current?.(go)) return;
    go();
  }, []);

  const setArea = useCallback(
    (next: Area) => {
      if (next === area) return;
      guarded(() => {
        setPrinterFocus(false);
        setAreaState(next);
      });
    },
    [area, guarded],
  );

  const switchUser = useCallback(() => guarded(onSwitchUser), [guarded, onSwitchUser]);

  const openPrinterSettings = useCallback(() => {
    setPrinterFocus(true);
    setAreaState("back-office");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        switchUser();
      } else if (key === "1") {
        event.preventDefault();
        setArea("sell");
      } else if (key === "2") {
        event.preventDefault();
        setArea("back-office");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switchUser, setArea]);

  const logOut = async () => {
    try {
      await window.vendora.auth.logout();
      onLoggedOut();
    } catch {
      setError(serviceErrorMessage);
    }
  };

  const requestLogOut = () => guarded(() => void logOut());

  return (
    <div className="grid h-screen grid-rows-[var(--height-title-bar)_minmax(0,1fr)_var(--height-hint-bar)] overflow-hidden bg-page">
      <TitleBar
        user={user}
        area={area}
        onAreaChange={setArea}
        onSwitchUser={switchUser}
        onLogOut={requestLogOut}
      />
      {area === "sell" ? (
        <SellArea
          onSessionEnded={onLoggedOut}
          onHintsChange={setSellHints}
          onOpenPrinterSettings={openPrinterSettings}
        />
      ) : (
        <BackOffice
          currentUserId={user.id}
          onSessionEnded={onLoggedOut}
          focusPrinter={printerFocus}
          guarded={guarded}
          registerLeaveGuard={registerLeaveGuard}
        />
      )}
      <HintBar hints={area === "sell" ? sellHints : backOfficeHints} error={error} />
    </div>
  );
}
