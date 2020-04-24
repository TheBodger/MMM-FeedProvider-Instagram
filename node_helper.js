//this loads instagram posts depending on its config when called to from the main module
//to minimise activity, it will track what data has been already sent back to the module
//and only send the delta each time

//this is done by making a note of the last published data of tweets sent to the module tracked at the tweet seach key level
//and ignoring anything older than that

//as some tweets wont have a published date, they will be allocated a pseudo published date of the latest published date in the current processed feeds

//if the module calls a RESET, then the date tracking is reset and all data will be sent 

//this is copied from other MMM-FeedPRovider modules and uses a common terminology of feed. this simply represent the incoming
//information and doesnt represent what the actual data is
//only the core changes will appear differently and reference the actual purpose of the module.

//nodehelper stuff:
//this.name String The name of the module

var NodeHelper = require("node_helper");

var request = require('request'); // for fetching the feed

//pseudo structures for commonality across all modules
//obtained from a helper file of modules

var LOG = require('../MMM-FeedUtilities/LOG');
var RSS = require('../MMM-FeedUtilities/RSS');
var QUEUE = require('../MMM-FeedUtilities/queueidea');
var UTILITIES = require('../MMM-FeedUtilities/utilities');

// structures

var rsssource = new RSS.RSSsource();

// local variables, held at provider level as this is a common module
//these are largely for the authors reference and are not actually used in thsi code

var providerstorage = {};

var trackingfeeddates = []; //an array of last date of feed recevied, one for each feed in the feeds index, build from the config
var aFeed = { lastFeedDate: '', feedURL: '' };

var payloadformodule = []; //we send back an array of identified stuff
var payloadstuffitem = { stuffID: '', stuff: '' }

var latestfeedpublisheddate = new Date(0) // set the date so no feeds are filtered, it is stored in providerstorage

module.exports = NodeHelper.create({

	start: function () {
		this.debug = true;
		console.log(this.name + ' node_helper is started!');
		this.logger = {};
		this.logger[null] = LOG.createLogger("MMM-FeedProvider-Instagram-node_helper" + ".log", this.name);
		this.queue = new QUEUE.queue("single", false);
		this.maxfeeddate = new Date(0); //used for date checking of posts
	},

	stop: function () {
		console.log("Shutting down node_helper");
	},

	setconfig: function (moduleinstance, config) {

		if (this.debug) { this.logger[moduleinstance].info("In setconfig: " + moduleinstance + " " + config); }

		//store a local copy so we dont have keep moving it about

		providerstorage[moduleinstance] = { config: config, trackingfeeddates: [] };

		var self = this;

		//process the feed details into the local feed tracker

		providerstorage[moduleinstance].config.feeds.forEach(function (configfeed) {

			var feed = { sourcetitle: '', lastFeedDate: '', searchterm: '', latestfeedpublisheddate: new Date(0) };

			//store the actual timestamp to start filtering, this will change as new feeds are pulled to the latest date of those feeds
			//if no date is available on a feed, then the current latest date of a feed published is allocated to it

			feed.lastFeedDate = self.calcTimestamp(configfeed.oldestage);
			feed.searchHashtag = configfeed.searchHashtag;
			feed.sourcetitle = configfeed.feedtitle;

			providerstorage[moduleinstance].trackingfeeddates.push(feed);

		});

	},

	calcTimestamp: function (age) {

		//calculate the actual timestamp to use for filtering feeds, 
		//options are timestamp format, today for midnight + 0.0001 seconds today, or age in minutes
		//determine the format of the data in age

		console.log(age);

		var filterDate = new Date();

		if (typeof (age) == 'number') {

			filterDate = new Date(filterDate.getTime() - (age * 60 * 1000));

		}
		else { //age is hopefully a string ha ha

			if (age.toLowerCase() == 'today') {
				filterDate = new Date(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate(), 0, 0, 0, 0)
			}

			else { //we assume the user entered a correct date - we can try some basic validation

				if (moment(age, "YYYY-MM-DD HH:mm:ss", true).isValid()) {
					filterDate = new Date(age);
				}
				else {

					console.log(this.name + " Invalid date provided for filter age of feeds:" + age.toString());
				}

			}
		}

		return filterDate;

	},

	getconfig: function () { return config; },

	reset: function (moduleinstance) {

		//clear the date we have been using to determine the latest data pulled for each feed

		//console.log(providerstorage[id].trackingfeeddates);

		providerstorage[moduleinstance].trackingfeeddates.forEach(function (feed) {

			//console.log(feed);

			feed['latestfeedpublisheddate'] = new Date(0);

			//console.log(feed);

		});

		//console.log(providerstorage[moduleinstance].trackingfeeddates);

	},

	socketNotificationReceived: function (notification, payload) {

		var self = this;

		if (this.logger[payload.moduleinstance] == null) {

			this.logger[payload.moduleinstance] = LOG.createLogger("logfile_" + payload.moduleinstance + ".log", payload.moduleinstance);

		};

		if (this.debug) {
			this.logger[payload.moduleinstance].info(this.name + " NODE HELPER notification: " + notification + " - Payload: ");
			this.logger[payload.moduleinstance].info(JSON.stringify(payload));
		}

		//we can receive these messages:
		//
		//RESET: clear any date processing or other so that all available stuff is returned to the module
		//CONFIG: we get our copy of the config to look after
		//UPDATE: request for any MORE stuff that we have not already sent
		//

		switch (notification) {
			case "CONFIG":
				this.setconfig(payload.moduleinstance, payload.config);
				break;
			case "RESET":
				this.reset(payload);
				break;
			case "UPDATE":
				//because we can get some of these in a browser refresh scenario, we check for the
				//local storage before accepting the request

				if (providerstorage[payload.moduleinstance] == null) { break; } //need to sort this out later !!
				self.processposts(payload.moduleinstance, payload.providerid);
				break;
			case "STATUS":
				this.showstatus(payload.moduleinstance);
				break;
		}

	},

	showstatus: function (moduleinstance) {

		console.log('============================ start of status ========================================');

		console.log('config for provider: ' + moduleinstance);

		console.log(providerstorage[moduleinstance].config);

		console.log('feeds for provider: ' + moduleinstance);

		console.log(providerstorage[moduleinstance].trackingfeeddates);

		console.log('============================= end of status =========================================');

	},

	processposts: function (moduleinstance, providerid) {

		var self = this;
		var feedidx = -1;

		if (this.debug) { this.logger[moduleinstance].info("In processfeeds: " + moduleinstance + " " + providerid); }

		providerstorage[moduleinstance].trackingfeeddates.forEach(function (feed) {

			if (self.debug) {
				self.logger[moduleinstance].info("In process feed: " + JSON.stringify(feed));
				self.logger[moduleinstance].info("In process feed: " + moduleinstance);
				self.logger[moduleinstance].info("In process feed: " + providerid);
				self.logger[moduleinstance].info("In process feed: " + feedidx);
				self.logger[moduleinstance].info("building queue " + self.queue.queue.length);
			}

			//we have to pass the providerid as we are going async now

			self.queue.addtoqueue(function () { self.fetchfeed(feed, moduleinstance, providerid, ++feedidx); });

		});

		this.queue.startqueue(providerstorage[moduleinstance].config.waitforqueuetime);

	},

	sendNotificationToMasterModule: function (stuff, stuff2) {
		this.sendSocketNotification(stuff, stuff2);
	},

	getParams: function (str) {

		var params = str.split(';').reduce(function (params, param) {

			var parts = param.split('=').map(function (part) { return part.trim(); });

			if (parts.length === 2) {

				params[parts[0]] = parts[1];

			}

			return params;

		}, {});

		return params;

	},

	done: function (err) {

		if (err) {

			console.log(err, err.stack);

		}

	},

	send: function (moduleinstance, providerid, source, feeds) {

		var payloadforprovider = { providerid: providerid, source: source, payloadformodule: feeds.items }

		if (this.debug) {
			this.logger[moduleinstance].info("In send, source, feeds // sending items this time: " + feeds.items.length );
			this.logger[moduleinstance].info(JSON.stringify(source));
			this.logger[moduleinstance].info(JSON.stringify(feeds));
		}

		if (feeds.items.length > 0) {
			this.sendNotificationToMasterModule("UPDATED_STUFF_" + moduleinstance, payloadforprovider);
		}

		this.queue.processended();

	},

	fetchfeed: function (feed, moduleinstance, providerid, feedidx) {

		// this to self
		var self = this;

		if (this.debug) {
			this.logger[moduleinstance].info("In fetch feed: " + JSON.stringify(feed));
			this.logger[moduleinstance].info("In fetch feed: " + moduleinstance);
			this.logger[moduleinstance].info("In fetch feed: " + providerid);
			this.logger[moduleinstance].info("In fetch feed: " + feedidx);
		}

		this.maxfeeddate = new Date(0);

		var rssitems = new RSS.RSSitems();

		var sourcetitle = feed.sourcetitle;
		// we use request module to capture the data for us
		// start of core instagram loop

		console.log(api_url);

		var api_url = `https://www.instagram.com/explore/tags/${feed.searchHashtag}/?__a=1`;

		//call request client based on query and params

		request({ url: api_url, method: 'GET' }, function (error, response, body) {

			if (!error && response.statusCode == 200) {

				if (self.debug) { self.logger[moduleinstance].info("meta: "); }

				self.parseInstagramPosts(providerstorage[moduleinstance].config, JSON.parse(body), feed, moduleinstance, rssitems); 

				if (self.debug) { self.logger[moduleinstance].info("tweets all pushed"); }

				for (var idx = 0; idx < rssitems.length; idx++) {

					if (rssitems[idx].imageURL != null) {
						if (RSS.checkfortrackingpixel(rssitems[idx].imageURL, moduleinstance)) {
							rssitems[idx].imageURL = null;
						}
					}
				}

				if (new Date(0) < self.maxfeeddate) {
					providerstorage[moduleinstance].trackingfeeddates[feedidx]['latestfeedpublisheddate'] = self.maxfeeddate;
				}

				self.send(moduleinstance, providerid, rsssource, rssitems);

				self.done();

			}
			// otherwise process error
			else {
				self.processError();
			}
		});

	},

	processError: function (err) {

		if (err) {

			console.log(err, err.stack);

		}

	},

	parseInstagramPosts: function (theConfig, items, feed, moduleinstance, rssitems) {

		var self = this;

		var includedTweetList = [];
		var userTweetCountList = {};
		var nowTime = Date.now();

		var posts = items.graphql.hashtag.edge_hashtag_to_top_posts.edges;
		var media = items.graphql.hashtag.edge_hashtag_to_media.edges;

		console.log(this.name + " #### instagram posts.length " + media.length);

		if (self.debug) { self.logger[moduleinstance].info("feedparser readable: "); }

		for (var mIndex = 0; mIndex < media.length; mIndex++) {

			var rssarticle = new RSS.RSSitem();
			var post = {};

			post['image'] = {}

			post['image']['url'] = media[mIndex].node.display_url;

			if (media[mIndex].node.edge_media_to_caption.edges.length > 0) { //sometimes there is no text in the node
				post['title'] = media[mIndex].node.edge_media_to_caption.edges[0].node.text;
			}
			else {
				post['title'] = '';
			}

			post['pubdate'] = new Date(media[mIndex].node.taken_at_timestamp * 1000);

			//process the caption into something like a description and categories

			post['categories'] = [];

			//"Photo by M R S & M R S  E D W A R D S in Suffolk. Image may contain: living room, table and indoor"

			if (media[mIndex].node.accessibility_caption != null) {

				var tempdesc = media[mIndex].node.accessibility_caption.toLowerCase();

				//split if it contains:  Image may contain:

				var res = tempdesc.split(" image may contain:");

				post['description'] = res[0];

				post['categories'] = [];

				if (res.length > 1) {
					res[1] = res[1].replace(" and ", ',').trim();
					post['categories'] = res[1].split(",");
				}
			}

			post['source'] = media[mIndex].node.owner.id;

			//end of converting the instagram item into a post format for standard processing

			if (this.debug) { self.logger[moduleinstance].info("feedparser post read: " + JSON.stringify(post.title)); }

			//ignore any feed older than feed.lastFeedDate or older than the last feed sent back to the modules
			//feed without a feed will be given the current latest feed data

			//because the feeds can come in in reverse date order, we only update the latest feed date at the end in send

			if (post.pubdate == null) {
				post.pubdate = new Date(feed.latestfeedpublisheddate.getTime() + 1);
				console.log("Article missing a date - so used: " + feed['latestfeedpublisheddate']);
			}

			if (post.pubdate >= feed.lastFeedDate && post.pubdate > feed.latestfeedpublisheddate) {

				rssarticle.id = rssarticle.gethashCode(post.title);
				rssarticle.title = post.title;

				rssarticle.pubdate = post.pubdate;
				self.maxfeeddate = new Date(Math.max(self.maxfeeddate, post.pubdate));

				rssarticle.description = post.description;
				rssarticle.age = rssarticle.getage(new Date(), rssarticle.pubdate); //in microseconds
				rssarticle.categories = post.categories;
				rssarticle.source = post.source;

				rssarticle.imageURL = post.image.url;

				if (self.debug) { self.logger[moduleinstance].info("article " + JSON.stringify(rssarticle)); }

				rssitems.items.push(rssarticle);

			}
			else {
				if (self.debug) { self.logger[moduleinstance].info("Already sent this item or it is too old - just like m. " + post.pubdate + " " + feed.lastFeedDate); }
			}

		} //end of processing this particular batch of tweets

	},

});
