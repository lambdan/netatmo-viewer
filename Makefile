demo-docker:
		docker build -t netatmo-viewer .
		docker run --rm -p 8080:8080 -e DEMO=1 netatmo-viewer
