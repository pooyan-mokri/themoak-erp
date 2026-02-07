'use client';

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
    >
      چاپ بارکد
    </button>
  );
}




