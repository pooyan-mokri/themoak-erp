'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SetupAdminPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const createAdmin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/setup-admin', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ success: false, message: 'Error: ' + error });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setup Admin User</CardTitle>
          <CardDescription>
            Create the initial admin user for the system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <Button onClick={createAdmin} disabled={loading} className="w-full">
              {loading ? 'Creating...' : 'Create Admin User'}
            </Button>
          ) : (
            <div className={`p-4 rounded-md ${result.success ? 'bg-green-50 dark:bg-green-900' : 'bg-red-50 dark:bg-red-900'}`}>
              <h3 className="font-bold mb-2">
                {result.success ? '✓ Success!' : '✗ Error'}
              </h3>
              <p className="text-sm mb-3">{result.message}</p>

              {result.success && result.credentials && (
                <div className="bg-white dark:bg-gray-800 p-3 rounded border">
                  <p className="font-bold mb-2">Login Credentials:</p>
                  <p className="text-sm"><strong>Email:</strong> {result.credentials.email}</p>
                  <p className="text-sm"><strong>Password:</strong> {result.credentials.password}</p>
                  <p className="text-sm text-orange-600 dark:text-orange-400 mt-2">
                    {result.credentials.warning}
                  </p>
                  <a
                    href="/login"
                    className="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Go to Login
                  </a>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
