import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Разрешаем запросы с любых сайтов (включая GitHub Pages)
CORS(app)

# Папка, куда будут сохраняться загруженные файлы
UPLOAD_FOLDER = '/root/xone/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"message": "Файл не найден в запросе"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"message": "Имя файла пустое"}), 400

    # Сохраняем файл на сервер
    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)
    print(f"Получен и сохранен файл: {file.filename}")
    
    return jsonify({"message": f"Файл {file.filename} сохранен на сервере!"})

if __name__ == '__main__':
    # Запускаем сервер на всех интерфейсах на порту 5000
    app.run(host='0.0.0.0', port=5000)
