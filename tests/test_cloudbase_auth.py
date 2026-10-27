"""Exercise the real bundled CloudBase auth SDK with mocked HTTP, never real credentials.
Run: python tests/test_cloudbase_auth.py
"""
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
from threading import Thread
import time
from urllib.parse import urlsplit, quote
from playwright.sync_api import sync_playwright

ENV = 'emotional-newt-d5gg8duqi1ab13685'
ROOT = Path(__file__).resolve().parents[1]
PASSWORD = 'Synthetic-Only-Password-"汉字-123'


def jwt(claims):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode(claims) + '.synthetic-only-signature'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    expires = int(time.time()) + 3600
    key = jwt({'sub': 'synthetic-public', 'scope': 'accessKey', 'exp': expires})
    user_token = jwt({'sub': 'synthetic-uid', 'scope': 'user', 'exp': expires})
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'), args=['--no-sandbox'])
            for scenario in ['success', 'origin', 'password', 'network', 'frontend']:
                context = browser.new_context()
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                paths = []

                def endpoint(route):
                    path = urlsplit(route.request.url).path
                    paths.append(path)
                    headers = {'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS'}
                    if route.request.method == 'OPTIONS':
                        route.fulfill(status=204, headers=headers)
                    elif path.endswith('/signin'):
                        if scenario == 'network':
                            route.abort()
                        elif scenario in ['origin', 'password']:
                            code = 'permission_denied' if scenario == 'origin' else 'invalid_username_or_password'
                            detail = 'Origin is not allowed' if scenario == 'origin' else 'Synthetic credential validation failure'
                            detail += ' password=' + PASSWORD + ' encoded=' + quote(PASSWORD, safe='') + ' access_token=' + user_token + ' key=' + key
                            route.fulfill(status=403 if scenario == 'origin' else 401, headers=headers, json={'error': code, 'error_code': 7 if scenario == 'origin' else 16, 'error_description': detail, 'requestId': 'synthetic-request-id'})
                        else:
                            assert route.request.post_data_json['username'] == 'synthetic-user'
                            assert route.request.post_data_json['password'] == PASSWORD
                            route.fulfill(headers=headers, json={'access_token': user_token, 'refresh_token': 'synthetic-only-refresh', 'token_type': 'Bearer', 'expires_in': 3600, 'scope': 'user'})
                    elif path.endswith('/user/me'):
                        assert route.request.headers.get('authorization') == 'Bearer ' + user_token
                        route.fulfill(headers=headers, json={'sub': 'synthetic-uid', 'uid': 'synthetic-uid', 'username': 'synthetic-user', 'name': 'Synthetic Person', 'groups': [], 'providers': []})
                    elif path == '/v1/rdb/rest/qijian_records':
                        assert route.request.headers.get('authorization') == 'Bearer ' + user_token
                        assert route.request.method == 'GET'
                        route.fulfill(headers=headers, json=[])
                    else:
                        raise AssertionError('Unexpected synthetic HTTP endpoint: ' + path)

                page.route('https://**/*', endpoint)
                page.goto(origin + '/cloudbase-test.html')
                if scenario == 'frontend':
                    page.evaluate("()=>{QijianCloudbase.init=()=>{throw new TypeError('Synthetic SDK runtime failure')};}")
                page.locator('#cloud-publishable').fill(key)
                page.locator('#cloud-username').fill('synthetic-user')
                page.locator('#cloud-password').fill(PASSWORD)
                page.locator('#cloud-login').click()
                if scenario == 'success':
                    page.wait_for_function("document.querySelector('#check-read').textContent==='读取成功'")
                    assert '/auth/v1/signin' in paths and '/auth/v1/user/me' in paths
                    assert '/v1/rdb/rest/qijian_records' in paths
                else:
                    page.wait_for_function("document.querySelector('#check-login').textContent==='登录未成功'")
                    diagnostic = page.locator('#cloud-diagnostic-text').inner_text()
                    assert PASSWORD not in diagnostic and quote(PASSWORD, safe='') not in diagnostic
                    assert key not in diagnostic and user_token not in diagnostic
                    assert page.locator('#cloud-diagnostics').get_attribute('open') is not None
                    if scenario == 'origin':
                        assert 'permission_denied' in diagnostic
                        assert 'Web 安全域名' in page.locator('#cloud-status').inner_text()
                    if scenario == 'password':
                        assert 'INVALID_CREDENTIALS' in diagnostic
                        assert '不能确认一定是密码错误' in page.locator('#cloud-status').inner_text()
                    if scenario == 'frontend':
                        assert '初始化 SDK' in diagnostic and 'TypeError' in diagnostic
                    assert '/v1/rdb/rest/qijian_records' not in paths
                assert page.locator('#cloud-password').input_value() == ''
                context.close()
            assert not errors, errors
            browser.close()
        print('PASS: real vendored SDK password login/user/token flow with mocked HTTP; domain/credential/network/runtime failure distinctions; diagnostic redaction of password, encoded password, client key and JWT; no database access on failed login; password cleared after attempts.')
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    main()
