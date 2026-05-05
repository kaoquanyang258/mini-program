from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from urllib import parse, request as urllib_request

app = Flask(__name__)
CORS(app, supports_credentials=True)

INFERENCE_SCRIPT_PATH = r'G:\YOLOv11_test\inference_test.py'
UPLOAD_FOLDER = r'G:\after_end_test\upload'
DATABASE_PATH = r'G:\after_end_test\apple_detection.db'
MODEL_ROOT = r'G:\YOLOv11_test\result'
MODEL_CONFIG_PATH = r'G:\after_end_test\model_config.json'
HISTORY_GROUP_GAP_SECONDS = 60
DEFAULT_MODEL_KEY = 'yolo11s_from_previous_v3_best'
TEMP_OPENID_ACCOUNT_PREFIX = 'wx_temp_'

MODEL_OPTIONS = [
    {
        'key': 'yolo11s_from_previous_v3_best',
        'name': 'YOLO11s V3',
        'folder': 'yolo11s_from_previous_v3_best',
        'description': '默认模型，适合日常检测使用。'
    },
    {
        'key': 'yolo5n_test',
        'name': 'YOLO5n',
        'folder': 'yolo5n_test',
        'description': '更轻量，适合更关注推理速度的场景。'
    },
    {
        'key': 'yolo8n_test',
        'name': 'YOLO8n',
        'folder': 'yolo8n_test',
        'description': '轻量备选模型，可用于效果对比。'
    }
]

MODEL_REGISTRY = {
    model['key']: {
        **model,
        'model_path': os.path.join(MODEL_ROOT, model['folder'], 'weights', 'best.pt')
    }
    for model in MODEL_OPTIONS
}


def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_column(cursor, table_name, column_name, column_definition):
    cursor.execute(f"PRAGMA table_info({table_name})")
    existing_columns = {row[1] for row in cursor.fetchall()}
    if column_name not in existing_columns:
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_definition}")


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_db_datetime(value):
    if not value:
        return None

    value = f"{value}".strip().replace('T', ' ')
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def clean_filename(filename):
    filename = filename.replace(' ', '')
    filename = ''.join(c for c in filename if c.isalnum() or c in ['.', '-', '_'])
    return filename


def serialize_model_info(model):
    return {
        'key': model['key'],
        'name': model['name'],
        'folder': model['folder'],
        'description': model['description']
    }


def get_model_by_key(model_key):
    return MODEL_REGISTRY.get(model_key) or MODEL_REGISTRY[DEFAULT_MODEL_KEY]


def get_default_model():
    return MODEL_REGISTRY[DEFAULT_MODEL_KEY]


def load_model_config():
    default_model = get_default_model()
    default_config = {
        'model_key': default_model['key'],
        'updated_at': ''
    }

    if not os.path.exists(MODEL_CONFIG_PATH):
        return default_config

    try:
        with open(MODEL_CONFIG_PATH, 'r', encoding='utf-8') as file:
            config = json.load(file)
    except (OSError, json.JSONDecodeError):
        return default_config

    model_key = config.get('model_key')
    if model_key not in MODEL_REGISTRY:
        return default_config

    return {
        'model_key': model_key,
        'updated_at': config.get('updated_at', '')
    }


def save_model_config(model_key):
    model = get_model_by_key(model_key)
    config = {
        'model_key': model['key'],
        'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }

    with open(MODEL_CONFIG_PATH, 'w', encoding='utf-8') as file:
        json.dump(config, file, ensure_ascii=False, indent=2)

    return config


def get_current_model_config():
    config = load_model_config()
    model = get_model_by_key(config['model_key'])
    return {
        'model_key': model['key'],
        'updated_at': config.get('updated_at', ''),
        'model': model
    }


def format_history_group(group):
    records = sorted(
        group['records'],
        key=lambda record: (
            safe_int(record.get('batch_index'), 10 ** 6),
            parse_db_datetime(record.get('date')) or datetime.min,
            safe_int(record.get('id'))
        )
    )

    formatted_records = []
    for index, record in enumerate(records, start=1):
        item = dict(record)
        item['image_label'] = f'第 {index} 张'
        formatted_records.append(item)

    batch_totals = [safe_int(record.get('batch_total')) for record in formatted_records if safe_int(record.get('batch_total')) > 0]
    latest_record = max(
        formatted_records,
        key=lambda record: parse_db_datetime(record.get('date')) or datetime.min
    ) if formatted_records else {}

    return {
        'id': group['id'],
        'batch_id': group['batch_id'],
        'date': latest_record.get('date', group.get('date')),
        'image_count': max(batch_totals) if batch_totals else len(formatted_records),
        'record_count': len(formatted_records),
        'total_apple_count': sum(safe_int(record.get('detection_count')) for record in formatted_records),
        'records': formatted_records
    }


def build_history_groups(records):
    if not records:
        return []

    sorted_records = sorted(
        records,
        key=lambda record: (
            parse_db_datetime(record.get('date')) or datetime.min,
            safe_int(record.get('id'))
        ),
        reverse=True
    )

    groups = []
    batch_group_map = {}
    fallback_group = None

    for index, record in enumerate(sorted_records):
        batch_id = (record.get('batch_id') or '').strip()
        record_datetime = parse_db_datetime(record.get('date'))

        if batch_id:
            group = batch_group_map.get(batch_id)
            if not group:
                group = {
                    'id': batch_id,
                    'batch_id': batch_id,
                    'date': record.get('date'),
                    'latest_datetime': record_datetime,
                    'records': []
                }
                batch_group_map[batch_id] = group
                groups.append(group)

            group['records'].append(record)
            if record_datetime and (group['latest_datetime'] is None or record_datetime > group['latest_datetime']):
                group['latest_datetime'] = record_datetime

            fallback_group = None
            continue

        should_create_new_group = (
            fallback_group is None or
            fallback_group.get('latest_datetime') is None or
            record_datetime is None or
            abs((fallback_group['latest_datetime'] - record_datetime).total_seconds()) > HISTORY_GROUP_GAP_SECONDS
        )

        if should_create_new_group:
            fallback_group = {
                'id': f"legacy_group_{record.get('id', index)}",
                'batch_id': '',
                'date': record.get('date'),
                'latest_datetime': record_datetime,
                'records': []
            }
            groups.append(fallback_group)

        fallback_group['records'].append(record)
        if record_datetime:
            fallback_group['latest_datetime'] = record_datetime

    groups.sort(key=lambda group: group.get('latest_datetime') or datetime.min, reverse=True)
    return [format_history_group(group) for group in groups]


def serialize_user(row):
    if not row:
        return None

    user_id = row['id']
    username = row['username'] or row['nickname'] or f'用户{user_id}'
    account = row['account'] or f'{TEMP_OPENID_ACCOUNT_PREFIX}{user_id}'
    login_type = row['login_type'] or ('openid' if row['openid'] else 'account')

    return {
        'userId': user_id,
        'username': username,
        'account': account,
        'loginType': login_type,
        'openid': row['openid'] or ''
    }


def init_database():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            openid TEXT UNIQUE,
            nickname TEXT,
            username TEXT,
            account TEXT,
            password TEXT,
            login_type TEXT DEFAULT "account",
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    if table_has_not_null_openid(cursor):
        rebuild_users_table_for_account_auth(cursor)

    ensure_column(cursor, 'users', 'username', 'username TEXT')
    ensure_column(cursor, 'users', 'account', 'account TEXT')
    ensure_column(cursor, 'users', 'password', 'password TEXT')
    ensure_column(cursor, 'users', 'login_type', 'login_type TEXT DEFAULT "account"')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS detection_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_openid TEXT,
            original_image_url TEXT,
            result_image_url TEXT,
            detection_count INTEGER,
            detection_details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    ensure_column(cursor, 'detection_records', 'user_id', 'user_id INTEGER')
    ensure_column(cursor, 'detection_records', 'batch_id', 'batch_id TEXT')
    ensure_column(cursor, 'detection_records', 'batch_total', 'batch_total INTEGER DEFAULT 1')
    ensure_column(cursor, 'detection_records', 'batch_index', 'batch_index INTEGER DEFAULT 1')

    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_openid ON detection_records(user_openid)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_batch ON detection_records(user_openid, batch_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_id ON detection_records(user_id)')
    cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_unique ON users(account)')
    cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid_unique ON users(openid)')

    cursor.execute('''
        UPDATE users
        SET username = COALESCE(NULLIF(username, ''), NULLIF(nickname, ''), '用户' || id)
        WHERE username IS NULL OR username = ''
    ''')

    cursor.execute('''
        UPDATE users
        SET login_type = CASE
            WHEN openid IS NOT NULL AND openid != '' THEN 'openid'
            ELSE COALESCE(NULLIF(login_type, ''), 'account')
        END
        WHERE login_type IS NULL OR login_type = ''
    ''')

    cursor.execute('''
        UPDATE detection_records
        SET user_id = (
            SELECT users.id FROM users WHERE users.openid = detection_records.user_openid
        )
        WHERE (user_id IS NULL OR user_id = 0) AND user_openid IS NOT NULL AND user_openid != ''
    ''')

    conn.commit()
    conn.close()


def table_has_not_null_openid(cursor):
    cursor.execute('PRAGMA table_info(users)')
    columns = cursor.fetchall()
    for column in columns:
        if column['name'] == 'openid':
            return bool(column['notnull'])
    return False


def rebuild_users_table_for_account_auth(cursor):
    cursor.execute('PRAGMA table_info(users)')
    existing_columns = {column['name'] for column in cursor.fetchall()}

    username_expr = (
        "COALESCE(NULLIF(username, ''), NULLIF(nickname, ''), '用户' || id)"
        if 'username' in existing_columns
        else "COALESCE(NULLIF(nickname, ''), '用户' || id)"
    )
    account_expr = 'account' if 'account' in existing_columns else 'NULL'
    password_expr = 'password' if 'password' in existing_columns else "''"
    login_type_expr = (
        "COALESCE(NULLIF(login_type, ''), CASE WHEN openid IS NOT NULL AND openid != '' THEN 'openid' ELSE 'account' END)"
        if 'login_type' in existing_columns
        else "CASE WHEN openid IS NOT NULL AND openid != '' THEN 'openid' ELSE 'account' END"
    )
    created_at_expr = 'created_at' if 'created_at' in existing_columns else 'CURRENT_TIMESTAMP'

    cursor.execute('DROP TABLE IF EXISTS users_new')
    cursor.execute('''
        CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            openid TEXT UNIQUE,
            nickname TEXT,
            username TEXT,
            account TEXT UNIQUE,
            password TEXT,
            login_type TEXT DEFAULT "account",
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute(f'''
        INSERT INTO users_new (id, openid, nickname, username, account, password, login_type, created_at)
        SELECT
            id,
            openid,
            nickname,
            {username_expr},
            {account_expr},
            {password_expr},
            {login_type_expr},
            {created_at_expr}
        FROM users
    ''')

    cursor.execute('DROP TABLE users')
    cursor.execute('ALTER TABLE users_new RENAME TO users')


def find_user_by_account(account):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE account = ?', (account,))
    row = cursor.fetchone()
    conn.close()
    return row


def find_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def find_user_by_openid(openid):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE openid = ?', (openid,))
    row = cursor.fetchone()
    conn.close()
    return row


def create_account_user(username, account, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO users (username, nickname, account, password, login_type) VALUES (?, ?, ?, ?, ?)',
        (username, username, account, password, 'account')
    )
    user_id = cursor.lastrowid
    conn.commit()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def get_or_create_temp_openid_user(openid):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE openid = ?', (openid,))
    row = cursor.fetchone()
    if row:
        conn.close()
        return row

    cursor.execute(
        'INSERT INTO users (openid, nickname, username, account, password, login_type) VALUES (?, ?, ?, ?, ?, ?)',
        (
            openid,
            '微信临时用户',
            f'微信用户{datetime.now().strftime("%H%M%S")}',
            f'{TEMP_OPENID_ACCOUNT_PREFIX}{datetime.now().strftime("%Y%m%d%H%M%S%f")}',
            '',
            'openid'
        )
    )
    user_id = cursor.lastrowid
    conn.commit()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def update_user_profile(user_id, username, password=''):
    conn = get_db_connection()
    cursor = conn.cursor()
    if password:
        cursor.execute(
            'UPDATE users SET username = ?, nickname = ?, password = ? WHERE id = ?',
            (username, username, password, user_id)
        )
    else:
        cursor.execute(
            'UPDATE users SET username = ?, nickname = ? WHERE id = ?',
            (username, username, user_id)
        )
    conn.commit()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def save_detection_record(
    user_id,
    user_openid,
    username,
    original_url,
    result_url,
    detection_count,
    detection_details,
    batch_id=None,
    batch_total=1,
    batch_index=1,
    created_at=None
):
    conn = get_db_connection()
    cursor = conn.cursor()
    created_at = created_at or datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    cursor.execute('''
        INSERT INTO detection_records
        (user_id, user_openid, original_image_url, result_image_url, detection_count, detection_details, batch_id, batch_total, batch_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        user_id,
        user_openid,
        original_url,
        result_url,
        detection_count,
        json.dumps(detection_details, ensure_ascii=False),
        batch_id,
        batch_total,
        batch_index,
        created_at
    ))

    record_id = cursor.lastrowid
    conn.commit()
    conn.close()

    print(f'保存检测记录成功，用户: {username}, 记录ID: {record_id}, 批次: {batch_id}')
    return {
        'record_id': record_id,
        'created_at': created_at
    }


def get_user_history(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, original_image_url, result_image_url, detection_count, detection_details, created_at, batch_id, batch_total, batch_index
        FROM detection_records
        WHERE user_id = ?
        ORDER BY created_at DESC
    ''', (user_id,))
    records = cursor.fetchall()
    conn.close()

    history_list = []
    for record in records:
        history_list.append({
            'id': record['id'],
            'original_image': record['original_image_url'],
            'result_image': record['result_image_url'],
            'detection_count': record['detection_count'],
            'detection_details': json.loads(record['detection_details']) if record['detection_details'] else [],
            'date': record['created_at'],
            'batch_id': record['batch_id'],
            'batch_total': record['batch_total'],
            'batch_index': record['batch_index']
        })

    return history_list


def load_inference_functions():
    print('=' * 60)
    print('加载推理模块...')

    if not os.path.exists(INFERENCE_SCRIPT_PATH):
        print(f'推理脚本不存在: {INFERENCE_SCRIPT_PATH}')
        return None, None, False

    try:
        spec = importlib.util.spec_from_file_location('apple_detector_module', INFERENCE_SCRIPT_PATH)
        inference_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inference_module)

        if hasattr(inference_module, 'init_detector') and hasattr(inference_module, 'detect_apple_simple'):
            print('推理模块导入成功')
            return inference_module.init_detector, inference_module.detect_apple_simple, True

        return None, None, False
    except Exception as error:
        print(f'导入推理模块失败: {error}')
        return None, None, False


init_detector, detect_apple_simple, INFERENCE_AVAILABLE = load_inference_functions()
init_database()

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    account = (data.get('account') or '').strip()
    password = (data.get('password') or '').strip()

    if not username or not account or not password:
        return jsonify({'success': False, 'msg': '请填写完整的注册信息'}), 400

    if find_user_by_account(account):
        return jsonify({'success': False, 'msg': '账号已存在'}), 400

    user = create_account_user(username, account, password)
    return jsonify({
        'success': True,
        'msg': '注册成功',
        'user': serialize_user(user)
    })


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    account = (data.get('account') or '').strip()
    password = (data.get('password') or '').strip()

    if not account or not password:
        return jsonify({'success': False, 'msg': '请输入账号和密码'}), 400

    user = find_user_by_account(account)
    if not user or (user['password'] or '') != password:
        return jsonify({'success': False, 'msg': '账号或密码错误'}), 400

    return jsonify({
        'success': True,
        'msg': '登录成功',
        'user': serialize_user(user)
    })


@app.route('/temp-openid-login', methods=['POST'])
def temp_openid_login():
    data = request.get_json(silent=True) or {}
    openid = (data.get('openid') or '').strip()

    if not openid:
        return jsonify({'success': False, 'msg': '缺少openid'}), 400

    user = get_or_create_temp_openid_user(openid)
    return jsonify({
        'success': True,
        'msg': '登录成功',
        'user': serialize_user(user)
    })


@app.route('/update-user', methods=['POST'])
def update_user():
    data = request.get_json(silent=True) or {}
    user_id = safe_int(data.get('user_id'))
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    if not user_id or not username:
        return jsonify({'success': False, 'msg': '缺少用户信息'}), 400

    user = find_user_by_id(user_id)
    if not user:
        return jsonify({'success': False, 'msg': '用户不存在'}), 404

    updated_user = update_user_profile(user_id, username, password)
    return jsonify({
        'success': True,
        'msg': '修改成功',
        'user': serialize_user(updated_user)
    })


@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_file():
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'preflight ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', '*')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': '没有文件'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': '没有选择文件'}), 400

        user_id = safe_int(request.form.get('user_id'))
        user = find_user_by_id(user_id)

        if not user:
            openid = (request.form.get('openid') or '').strip()
            if openid:
                user = get_or_create_temp_openid_user(openid)
                user_id = user['id']

        if not user:
            return jsonify({'success': False, 'error': '用户不存在，请重新登录'}), 400

        current_user = serialize_user(user)
        batch_id = (request.form.get('batch_id') or '').strip()
        batch_total = max(safe_int(request.form.get('batch_total'), 1), 1)
        batch_index = max(safe_int(request.form.get('batch_index'), 1), 1)

        if not batch_id:
            batch_id = f"single_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

        current_model_config = get_current_model_config()
        current_model = current_model_config['model']
        if not os.path.exists(current_model['model_path']):
            return jsonify({
                'success': False,
                'error': f"当前模型权重不存在: {current_model['model_path']}"
            }), 500

        now = datetime.now()
        timestamp = now.strftime('%Y%m%d%H%M%S%f')
        record_created_at = now.strftime('%Y-%m-%d %H:%M:%S')
        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
        ext = ext.strip()

        original_filename = clean_filename(f'{timestamp}_original.{ext}')
        result_filename = clean_filename(f'{timestamp}_result.{ext}')

        host = request.host
        if 'ngrok-free.dev' in host:
            hostname = host.split(':')[0]
            base_url = f'https://{hostname}'
        else:
            base_url = f'http://{host}'

        original_path = os.path.join(UPLOAD_FOLDER, original_filename)
        file.save(original_path)

        if not os.path.exists(original_path):
            return jsonify({'success': False, 'error': '文件保存失败'}), 500

        response_data = {
            'success': True,
            'original_url': f'{base_url}/uploads/{original_filename}',
            'timestamp': timestamp,
            'date': record_created_at,
            'user_id': current_user['userId'],
            'user_name': current_user['username'],
            'batch_id': batch_id,
            'batch_total': batch_total,
            'batch_index': batch_index,
            'model_key': current_model['key'],
            'model_name': current_model['name']
        }

        if INFERENCE_AVAILABLE and init_detector and detect_apple_simple:
            inference_result = detect_apple_simple(
                image_path=original_path,
                output_dir=UPLOAD_FOLDER,
                model_path=current_model['model_path']
            )

            if inference_result.get('success'):
                result_path = inference_result.get('result_image', '')
                if result_path and os.path.exists(result_path):
                    final_result_path = os.path.join(UPLOAD_FOLDER, result_filename)
                    shutil.copy2(result_path, final_result_path)

                    detection_count = inference_result.get('count', 0)
                    detections = inference_result.get('detections', [])

                    record_info = save_detection_record(
                        user_id=current_user['userId'],
                        user_openid=current_user['openid'],
                        username=current_user['username'],
                        original_url=f'{base_url}/uploads/{original_filename}',
                        result_url=f'{base_url}/uploads/{result_filename}',
                        detection_count=detection_count,
                        detection_details=detections,
                        batch_id=batch_id,
                        batch_total=batch_total,
                        batch_index=batch_index,
                        created_at=record_created_at
                    )

                    response_data.update({
                        'result_url': f'{base_url}/uploads/{result_filename}',
                        'detection_count': detection_count,
                        'detections': detections,
                        'inference_success': True,
                        'record_id': record_info['record_id'],
                        'date': record_info['created_at']
                    })
                else:
                    response_data.update({
                        'inference_success': False,
                        'inference_error': '推理结果文件未生成'
                    })
            else:
                response_data.update({
                    'inference_success': False,
                    'inference_error': inference_result.get('error', '推理失败')
                })
        else:
            response_data.update({
                'inference_success': False,
                'inference_error': '推理模块未加载'
            })

        return jsonify(response_data)
    except Exception as error:
        print(f'上传出错: {error}')
        return jsonify({'success': False, 'error': str(error)}), 500


@app.route('/uploads/<path:filename>')
def get_uploaded_file(filename):
    try:
        filename = clean_filename(filename)
        return send_from_directory(UPLOAD_FOLDER, filename)
    except Exception:
        return jsonify({'success': False, 'error': f'文件不存在: {filename}'}), 404


@app.route('/model-config', methods=['GET', 'POST'])
def model_config():
    try:
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            model_key = data.get('model_key')

            if not model_key:
                return jsonify({'success': False, 'msg': '缺少模型标识'}), 400

            if model_key not in MODEL_REGISTRY:
                return jsonify({'success': False, 'msg': '模型不存在'}), 400

            selected_model = get_model_by_key(model_key)
            if not os.path.exists(selected_model['model_path']):
                return jsonify({
                    'success': False,
                    'msg': f"模型权重不存在: {selected_model['model_path']}"
                }), 400

            config = save_model_config(model_key)
            current_model = get_model_by_key(config['model_key'])

            return jsonify({
                'success': True,
                'msg': f"已切换到 {current_model['name']}",
                'current_model_key': current_model['key'],
                'current_model': serialize_model_info(current_model),
                'updated_at': config['updated_at'],
                'models': [serialize_model_info(model) for model in MODEL_OPTIONS]
            })

        current_model_config = get_current_model_config()
        return jsonify({
            'success': True,
            'current_model_key': current_model_config['model_key'],
            'current_model': serialize_model_info(current_model_config['model']),
            'updated_at': current_model_config['updated_at'],
            'default_model_key': DEFAULT_MODEL_KEY,
            'models': [serialize_model_info(model) for model in MODEL_OPTIONS]
        })
    except Exception as error:
        return jsonify({'success': False, 'msg': f'模型配置失败: {error}'}), 500


@app.route('/history', methods=['GET'])
def get_history():
    user_id = safe_int(request.args.get('user_id'))
    if not user_id:
        return jsonify({'success': False, 'msg': '缺少用户ID'}), 400

    user = find_user_by_id(user_id)
    if not user:
        return jsonify({'success': False, 'msg': '用户不存在'}), 404

    history = get_user_history(user_id)
    history_groups = build_history_groups(history)

    return jsonify({
        'success': True,
        'history': history,
        'history_groups': history_groups,
        'count': len(history),
        'group_count': len(history_groups)
    })


@app.route('/clear-history', methods=['POST'])
def clear_history():
    data = request.get_json(silent=True) or {}
    user_id = safe_int(data.get('user_id'))
    if not user_id:
        return jsonify({'success': False, 'msg': '缺少用户ID'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM detection_records WHERE user_id = ?', (user_id,))
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'msg': f'已清空 {deleted_count} 条历史记录'
    })


@app.route('/test', methods=['GET'])
def test():
    current_model_config = get_current_model_config()
    return jsonify({
        'status': 'success',
        'message': '后端运行正常',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'current_model_key': current_model_config['model_key'],
        'current_model_name': current_model_config['model']['name'],
        'inference_available': INFERENCE_AVAILABLE,
        'python_executable': sys.executable
    })


@app.route('/get-openid', methods=['POST'])
def get_openid():
    try:
        data = request.get_json(silent=True) or {}
        code = data.get('code')
        if not code:
            return jsonify({'success': False, 'msg': '缺少code参数'}), 400

        appid = ''
        appsecret = ''
        query = parse.urlencode({
            'appid': appid,
            'secret': appsecret,
            'js_code': code,
            'grant_type': 'authorization_code'
        })
        wechat_url = f'https://api.weixin.qq.com/sns/jscode2session?{query}'

        with urllib_request.urlopen(wechat_url, timeout=10) as response:
            wechat_data = json.loads(response.read().decode('utf-8'))

        openid = wechat_data.get('openid')
        if not openid:
            return jsonify({'success': False, 'msg': '获取openid失败', 'detail': wechat_data}), 401

        return jsonify({
            'success': True,
            'openid': openid,
            'msg': '获取成功'
        })
    except Exception as error:
        return jsonify({'success': False, 'msg': f'获取失败: {error}'}), 500


if __name__ == '__main__':
    current_model_config = get_current_model_config()
    print('=' * 60)
    print('苹果检测后端启动')
    print(f"Python解释器: {sys.executable}")
    print(f"上传目录: {UPLOAD_FOLDER}")
    print(f"当前模型: {current_model_config['model']['name']}")
    print(f"模型路径: {current_model_config['model']['model_path']}")
    print(f"推理脚本: {INFERENCE_SCRIPT_PATH}")
    print(f"推理功能: {'可用' if INFERENCE_AVAILABLE else '不可用'}")
    print('=' * 60)

    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
