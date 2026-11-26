import { useState } from 'react';
import { LogIn, UserPlus, Building2 } from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { ensureActiveCompanyId } from '../utils/supabaseApi';

export default function AuthGate({ onAuthenticated }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpErr) throw signUpErr;
        if (!data.session) {
          setInfo('Check your inbox to confirm your email address, then sign in.');
          setMode('signin');
          return;
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) throw signInErr;
      }
      await ensureActiveCompanyId();
      onAuthenticated();
    } catch (err) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="server-down-overlay">
      <div className="server-down-modal" style={{ maxWidth: 420 }}>
        <Building2 size={44} color="#3b82f6" style={{ margin: '0 auto 0.5rem' }} />
        <h2>{mode === 'signin' ? 'Employee Sign In' : 'Create Employee Account'}</h2>
        <p style={{ marginBottom: '0.75rem' }}>
          Sign in to access your company&apos;s shared GST billing &amp; inventory workspace.
        </p>

        <form onSubmit={handleSubmit} style={{ textAlign: 'left', marginTop: '1rem' }}>
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label className="form-label" htmlFor="auth-email">Work Email</label>
            <input
              id="auth-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group" style={{ marginBottom: '0.9rem' }}>
            <label className="form-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ color: '#059669', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              {info}
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {mode === 'signin' ? <LogIn size={16} /> : <UserPlus size={16} />}
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={{ marginTop: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {mode === 'signin' ? (
            <>
              Need an account?{' '}
              <button type="button" className="link-btn" onClick={() => { setMode('signup'); setError(''); setInfo(''); }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already registered?{' '}
              <button type="button" className="link-btn" onClick={() => { setMode('signin'); setError(''); setInfo(''); }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
