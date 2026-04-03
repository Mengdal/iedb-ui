import React, { createContext, useContext, useState, useEffect } from 'react';

export interface ServerConnection {
  id: string;
  name: string;
  protocol: 'http://' | 'https://';
  host: string;
  token: string;
}

interface ServerContextType {
  servers: ServerConnection[];
  selectedServerId: string | null;
  addServer: (server: Omit<ServerConnection, 'id'>) => void;
  updateServer: (id: string, server: Omit<ServerConnection, 'id'>) => void;
  deleteServer: (id: string) => void;
  selectServer: (id: string) => void;
  activeServer: ServerConnection | undefined;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export const useServers = () => {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error('useServers must be used within a ServerProvider');
  }
  return context;
};

// Initial mock data to match the UI state seen in screenshots
const initialServers: ServerConnection[] = [];

export const ServerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [servers, setServers] = useState<ServerConnection[]>(() => {
    const saved = localStorage.getItem('iotedge-servers');
    return saved ? JSON.parse(saved) : initialServers;
  });
  
  const [selectedServerId, setSelectedServerId] = useState<string | null>(() => {
    const saved = localStorage.getItem('iotedge-selected-server');
    return saved ? saved : (initialServers.length > 0 ? initialServers[0].id : null);
  });

  useEffect(() => {
    localStorage.setItem('iotedge-servers', JSON.stringify(servers));
  }, [servers]);

  useEffect(() => {
    if (selectedServerId) {
      localStorage.setItem('iotedge-selected-server', selectedServerId);
    } else {
      localStorage.removeItem('iotedge-selected-server');
    }
  }, [selectedServerId]);

  const addServer = (serverData: Omit<ServerConnection, 'id'>) => {
    const newServer = { ...serverData, id: Date.now().toString() };
    setServers(prev => [...prev, newServer]);
    if (!selectedServerId) {
      setSelectedServerId(newServer.id);
    }
  };

  const updateServer = (id: string, serverData: Omit<ServerConnection, 'id'>) => {
    setServers(prev => prev.map(s => s.id === id ? { ...serverData, id } : s));
  };

  const deleteServer = (id: string) => {
    setServers(prev => prev.filter(s => s.id !== id));
    if (selectedServerId === id) {
      setSelectedServerId(null); // Or select another available server
    }
  };

  const selectServer = (id: string) => {
    setSelectedServerId(id);
  };

  const activeServer = servers.find(s => s.id === selectedServerId);

  return (
    <ServerContext.Provider 
      value={{ servers, selectedServerId, addServer, updateServer, deleteServer, selectServer, activeServer }}
    >
      {children}
    </ServerContext.Provider>
  );
};
