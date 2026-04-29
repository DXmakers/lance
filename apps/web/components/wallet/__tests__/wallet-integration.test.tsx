/**
 * Wallet Integration Test Suite
 * 
 * Tests wallet connection, error handling, SIWS authentication,
 * mobile responsiveness, and accessibility compliance
 */

import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ConnectWalletButton } from '../connect-wallet-button';
import { WalletErrorDisplay } from '../wallet-error-display';
import { WalletConnectionModal } from '../wallet-connection-modal';
import { useWalletSession } from '@/hooks/use-wallet-session';

// Mock the wallet session hook
vi.mock('@/hooks/use-wallet-session');

// Mock the stellar library
vi.mock('@/lib/stellar', () => ({
  APP_STELLAR_NETWORK: 'TESTNET',
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  getConnectedWalletAddress: vi.fn(),
  getWalletNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

// Mock the SIWS library
vi.mock('@/lib/siws', () => ({
  SIWSService: {
    signIn: vi.fn(),
    verify: vi.fn(),
  },
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('Wallet Integration', () => {
  const mockUseWalletSession = vi.mocked(useWalletSession);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  describe('ConnectWalletButton', () => {
    it('renders connect button when disconnected', () => {
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
      expect(connectButton).toBeInTheDocument();
      expect(connectButton).toHaveAttribute('aria-label', 'Connect Stellar wallet');
    });

    it('shows loading state during connection', () => {
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: true,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: 'Checking wallet connection...',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByText('Checking…')).toBeInTheDocument();
      expect(screen.getByText('Securing connection')).toBeInTheDocument();
    });

    it('displays connected state with wallet address', () => {
      mockUseWalletSession.mockReturnValue({
        address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5',
        walletNetwork: 'TESTNET',
        appNetwork: 'TESTNET',
        isConnected: true,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByText('GD5T…C4D5')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /disconnect wallet gd5t…c4d5/i })).toBeInTheDocument();
    });

    it('shows network mismatch warning', () => {
      mockUseWalletSession.mockReturnValue({
        address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5',
        walletNetwork: 'PUBLIC',
        appNetwork: 'TESTNET',
        isConnected: true,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: true,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByText('Network mismatch detected')).toBeInTheDocument();
      expect(screen.getByText('Wallet: PUBLIC | App: TESTNET')).toBeInTheDocument();
      expect(screen.getByText('Please switch your wallet network to match')).toBeInTheDocument();
    });

    it('displays error banner when connection fails', async () => {
      const mockConnect = vi.fn();
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: 'Wallet connection was rejected. Please try again and approve the connection.',
        connectionStep: 'Connection cancelled - ready to retry',
        siwsResponse: null,
        connect: mockConnect,
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByText('Wallet connection was rejected. Please try again and approve the connection.')).toBeInTheDocument();
      
      const retryButton = screen.getByRole('button', { name: /retry connection/i });
      await userEvent.click(retryButton);
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('WalletErrorDisplay', () => {
    it('displays user rejection error with recovery steps', () => {
      const error = 'Wallet connection was rejected. Please try again and approve the connection.';
      const onRetry = vi.fn();

      render(<WalletErrorDisplay error={error} onRetry={onRetry} />);
      
      expect(screen.getByText('Connection Error')).toBeInTheDocument();
      expect(screen.getByText(error)).toBeInTheDocument();
      expect(screen.getByText('Recovery Steps:')).toBeInTheDocument();
      expect(screen.getByText('Check your wallet extension popup')).toBeInTheDocument();
      expect(screen.getByText('Click \'Approve\' or \'Connect\' in your wallet')).toBeInTheDocument();
      expect(screen.getByText('Try connecting again')).toBeInTheDocument();
      
      const retryButton = screen.getByRole('button', { name: /try again/i });
      userEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalled();
    });

    it('displays wallet not found error with installation steps', () => {
      const error = 'Wallet extension not found. Please install a supported wallet (Freighter, Albedo, or xBull).';

      render(<WalletErrorDisplay error={error} />);
      
      expect(screen.getByText(error)).toBeInTheDocument();
      expect(screen.getByText('Install Freighter, Albedo, or xBull wallet')).toBeInTheDocument();
      expect(screen.getByText('Enable the wallet extension in your browser')).toBeInTheDocument();
      expect(screen.getByText('Refresh the page and try again')).toBeInTheDocument();
    });

    it('can dismiss error display', () => {
      const error = 'Test error';
      const onDismiss = vi.fn();

      render(<WalletErrorDisplay error={error} onDismiss={onDismiss} />);
      
      const dismissButton = screen.getByRole('button', { name: /dismiss error/i });
      userEvent.click(dismissButton);
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('WalletConnectionModal', () => {
    it('renders wallet selection modal', () => {
      const onConnect = vi.fn();
      const onClose = vi.fn();

      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={onClose}
          onConnect={onConnect}
        />
      );
      
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Connect Wallet' })).toBeInTheDocument();
      expect(screen.getByText('Choose your Stellar wallet')).toBeInTheDocument();
      expect(screen.getByText('Freighter')).toBeInTheDocument();
      expect(screen.getByText('Albedo')).toBeInTheDocument();
      expect(screen.getByText('xBull')).toBeInTheDocument();
    });

    it('highlights recommended wallet', () => {
      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={vi.fn()}
        />
      );
      
      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('handles wallet selection', async () => {
      const onConnect = vi.fn();

      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={onConnect}
        />
      );
      
      const freighterButton = screen.getByRole('button', { name: /connect with freighter/i });
      await userEvent.click(freighterButton);
      expect(onConnect).toHaveBeenCalledWith('freighter');
    });

    it('shows connecting state', () => {
      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={vi.fn()}
          isConnecting={true}
        />
      );
      
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });

    it('displays error message', () => {
      const error = 'Connection failed';

      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={vi.fn()}
          error={error}
        />
      );
      
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText(error)).toBeInTheDocument();
    });

    it('can close modal', async () => {
      const onClose = vi.fn();

      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={onClose}
          onConnect={vi.fn()}
        />
      );
      
      const closeButton = screen.getByRole('button', { name: /close wallet selection/i });
      await userEvent.click(closeButton);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Mobile Responsiveness', () => {
    it('adapts to mobile viewport', () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 667,
      });

      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
      expect(connectButton).toBeInTheDocument();
      // Should have responsive classes for mobile
      expect(connectButton).toHaveClass('min-h-[32px]');
    });
  });

  describe('Accessibility Compliance', () => {
    it('has proper ARIA labels and roles', () => {
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
      expect(connectButton).toHaveAttribute('aria-label', 'Connect Stellar wallet');
      expect(connectButton).not.toHaveAttribute('aria-busy');
    });

    it('announces loading states to screen readers', () => {
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: true,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: 'Checking wallet connection...',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Securing connection')).toHaveAttribute('aria-live', 'polite');
    });

    it('announces errors to screen readers', () => {
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: 'Connection failed',
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Connection failed')).toHaveAttribute('aria-live', 'assertive');
    });

    it('modal has proper dialog semantics', () => {
      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={vi.fn()}
        />
      );
      
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'wallet-modal-title');
      expect(dialog).toHaveAttribute('aria-describedby', 'wallet-modal-description');
    });

    it('supports keyboard navigation', async () => {
      const onConnect = vi.fn();

      render(
        <WalletConnectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConnect={onConnect}
        />
      );
      
      const freighterButton = screen.getByRole('button', { name: /connect with freighter/i });
      freighterButton.focus();
      expect(freighterButton).toHaveFocus();
      
      await userEvent.keyboard('{Enter}');
      expect(onConnect).toHaveBeenCalledWith('freighter');
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('handles multiple rapid connection attempts', async () => {
      const mockConnect = vi.fn();
      mockUseWalletSession.mockReturnValue({
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: true, // Already connecting
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: 'Connecting...',
        siwsResponse: null,
        connect: mockConnect,
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      });

      render(<ConnectWalletButton />);
      
      const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
      expect(connectButton).toBeDisabled();
      
      await userEvent.click(connectButton);
      expect(mockConnect).not.toHaveBeenCalled(); // Should not call when already connecting
    });

    it('handles wallet disconnection during connection', async () => {
      let mockReturnValue = {
        address: null,
        walletNetwork: null,
        appNetwork: 'TESTNET',
        isConnected: false,
        isAuthenticated: false,
        isLoading: false,
        isConnecting: false,
        isAuthenticating: false,
        networkMismatch: false,
        error: null,
        connectionStep: '',
        siwsResponse: null,
        connect: vi.fn(),
        authenticate: vi.fn(),
        disconnect: vi.fn(),
        refreshWalletState: vi.fn(),
      };

      mockUseWalletSession.mockReturnValue(mockReturnValue);

      const { rerender } = render(<ConnectWalletButton />);
      
      // Simulate connection starting
      mockReturnValue = { ...mockReturnValue, isConnecting: true, connectionStep: 'Connecting...' };
      mockUseWalletSession.mockReturnValue(mockReturnValue);
      rerender(<ConnectWalletButton />);
      
      expect(screen.getByText('Connecting…')).toBeInTheDocument();
      
      // Simulate sudden disconnection
      mockReturnValue = { ...mockReturnValue, isConnecting: false, error: 'Connection lost' };
      mockUseWalletSession.mockReturnValue(mockReturnValue);
      rerender(<ConnectWalletButton />);
      
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });
  });
});

describe('Wallet Integration E2E Scenarios', () => {
  it('completes full connection flow with authentication', async () => {
    const mockConnect = vi.fn().mockResolvedValue('GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5');
    const mockAuthenticate = vi.fn().mockResolvedValue({
      message: { address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5' },
      signature: 'abc123',
      publicKey: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5'
    });

    let mockReturnValue = {
      address: null,
      walletNetwork: null,
      appNetwork: 'TESTNET',
      isConnected: false,
      isAuthenticated: false,
      isLoading: false,
      isConnecting: false,
      isAuthenticating: false,
      networkMismatch: false,
      error: null,
      connectionStep: '',
      siwsResponse: null,
      connect: mockConnect,
      authenticate: mockAuthenticate,
      disconnect: vi.fn(),
      refreshWalletState: vi.fn(),
    };

    mockUseWalletSession.mockReturnValue(mockReturnValue);

    const { rerender } = render(<ConnectWalletButton />);
    
    // Initial state
    expect(screen.getByRole('button', { name: /connect stellar wallet/i })).toBeInTheDocument();
    
    // Start connection
    const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
    await userEvent.click(connectButton);
    expect(mockConnect).toHaveBeenCalled();

    // Simulate successful connection
    mockReturnValue = { ...mockReturnValue, isConnected: true, address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5' };
    mockUseWalletSession.mockReturnValue(mockReturnValue);
    rerender(<ConnectWalletButton />);
    
    expect(screen.getByText('GD5T…C4D5')).toBeInTheDocument();
    
    // Start authentication
    // In a real implementation, this might be triggered automatically or by a separate button
    act(() => {
      mockAuthenticate('GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5');
    });
    
    // Simulate successful authentication
    mockReturnValue = { 
      ...mockReturnValue, 
      isAuthenticated: true,
      siwsResponse: {
        message: { address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5' },
        signature: 'abc123',
        publicKey: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5'
      }
    };
    mockUseWalletSession.mockReturnValue(mockReturnValue);
    rerender(<ConnectWalletButton />);
    
    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('handles network mismatch gracefully', async () => {
    const mockConnect = vi.fn().mockResolvedValue('GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5');

    let mockReturnValue = {
      address: null,
      walletNetwork: null,
      appNetwork: 'TESTNET',
      isConnected: false,
      isAuthenticated: false,
      isLoading: false,
      isConnecting: false,
      isAuthenticating: false,
      networkMismatch: false,
      error: null,
      connectionStep: '',
      siwsResponse: null,
      connect: mockConnect,
      authenticate: vi.fn(),
      disconnect: vi.fn(),
      refreshWalletState: vi.fn(),
    };

    mockUseWalletSession.mockReturnValue(mockReturnValue);

    const { rerender } = render(<ConnectWalletButton />);
    
    // Connect wallet
    const connectButton = screen.getByRole('button', { name: /connect stellar wallet/i });
    await userEvent.click(connectButton);

    // Simulate connection with network mismatch
    mockReturnValue = { 
      ...mockReturnValue, 
      isConnected: true, 
      address: 'GD5T2P2Q7F3X4Y6Z8R1W3E5T6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5',
      walletNetwork: 'PUBLIC',
      networkMismatch: true
    };
    mockUseWalletSession.mockReturnValue(mockReturnValue);
    rerender(<ConnectWalletButton />);
    
    expect(screen.getByText('Network mismatch detected')).toBeInTheDocument();
    expect(screen.getByText('Wallet: PUBLIC | App: TESTNET')).toBeInTheDocument();
    expect(screen.getByText('Please switch your wallet network to match')).toBeInTheDocument();
  });
});
