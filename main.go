package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Message struct {
	Nick string `json:"nick"`
	Text string `json:"text"`
	Time string `json:"time"`
}

var (
	messages []Message
	mu       sync.Mutex
)

func main() {
	// Фоновый таймер: очищает чат каждые 5 минут
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			mu.Lock()
			messages = []Message{}
			mu.Unlock()
			fmt.Println("Чат очищен по таймеру (5 минут)")
		}
	}()

	// Отдаем сам HTML-файл при заходе на http://103.82.102.226:8080
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	// Получение списка сообщений
	http.HandleFunc("/messages", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		mu.Lock()
		defer mu.Unlock()
		if messages == nil {
			messages = []Message{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(messages)
	})

	// Отправка нового сообщения
	http.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == "OPTIONS" {
			return
		}
		if r.Method != "POST" {
			http.Error(w, "Только POST", http.StatusMethodNotAllowed)
			return
		}

		var msg Message
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			http.Error(w, "Ошибка данных", http.StatusBadRequest)
			return
		}

		if msg.Nick == "" || msg.Text == "" {
			return
		}

		msg.Time = time.Now().Format("15:04")

		mu.Lock()
		messages = append(messages, msg)
		mu.Unlock()

		w.WriteHeader(http.StatusOK)
	})

	fmt.Println("Сервер TX запущен на порту :8080")
	http.ListenAndServe(":8080", nil)
}

func enableCors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}
