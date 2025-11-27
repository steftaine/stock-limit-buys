#!/usr/bin/env python3
"""
Simple CORS proxy for Yahoo Finance API
Runs on http://localhost:8001
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.parse
import json

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Enable CORS
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        # Extract the target URL from query parameter
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        
        if 'url' not in params:
            self.wfile.write(json.dumps({'error': 'Missing url parameter'}).encode())
            return
        
        target_url = params['url'][0]
        
        try:
            print(f"Proxying: {target_url}")
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'Mozilla/5.0')
            
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read()
                self.wfile.write(data)
                
        except Exception as e:
            print(f"Error: {e}")
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

if __name__ == '__main__':
    port = 8001
    server = HTTPServer(('localhost', port), ProxyHandler)
    print(f"✓ Proxy server running on http://localhost:{port}")
    print(f"Usage: http://localhost:{port}/?url=<encoded_url>")
    server.serve_forever()
