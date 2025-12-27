'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getCompanyInfo } from '@/actions/settings';

interface LogoContextType {
  logo?: string;
  refreshLogo: () => void;
}

const LogoContext = createContext<LogoContextType | undefined>(undefined);

export function LogoProvider({ children }: { children: ReactNode }) {
  const [logo, setLogo] = useState<string | null>(null);

  const refreshLogo = () => {
    getCompanyInfo()
      .then((companyInfo) => {
        setLogo(companyInfo?.logo || null);
      })
      .catch((error) => {
        console.error('Error loading logo:', error);
        setLogo(null);
      });
  };

  useEffect(() => {
    refreshLogo();
  }, []);

  return (
    <LogoContext.Provider value={{ logo, refreshLogo }}>
      {children}
    </LogoContext.Provider>
  );
}

export function useLogo() {
  const context = useContext(LogoContext);
  if (context === undefined) {
    throw new Error('useLogo must be used within a LogoProvider');
  }
  return context;
}

