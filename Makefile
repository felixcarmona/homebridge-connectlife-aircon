-include .env
export

.PHONY: clean lint build deploy

GLOBAL_NODE_MODULES = /usr/local/lib/node_modules
PLUGIN_NAME = homebridge-connectlife-aircon
PLUGIN_DIR = $(GLOBAL_NODE_MODULES)/$(PLUGIN_NAME)

RSYNC_EXCLUDES = \
	--exclude node_modules \
	--exclude .git \
	--exclude .DS_Store

lint:
	npx tsc --noEmit

clean:
	rm -rf node_modules package-lock.json dist

build: lint clean
	npm install
	npx tsc

deploy: build
	rsync -avz $(RSYNC_EXCLUDES) ./ \
	$(DEPLOY_REMOTE_USER)@$(DEPLOY_REMOTE_HOST):/tmp/$(PLUGIN_NAME)

	ssh $(DEPLOY_REMOTE_USER)@$(DEPLOY_REMOTE_HOST) "\
		sudo rm -rf $(PLUGIN_DIR) && \
		sudo mv /tmp/$(PLUGIN_NAME) $(PLUGIN_DIR) && \
		sudo chown -R root:root $(PLUGIN_DIR) && \
		cd $(PLUGIN_DIR) && \
		sudo npm install --production && \
		sudo systemctl restart homebridge \
	"