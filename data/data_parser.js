var fs = require('fs');
var csv = require('csv-parser');
var Q = require('q');
var async = require('async');
var mongoose = require('mongoose');
var WikiModel = require('./model').WikiModel;
var dbUrl = require('../package.json').database;

var path = __dirname;

function parsecvs(file) {
  var rows = [];
  var defer = Q.defer();
  fs.createReadStream(file)
    .pipe(csv())
    .on('data', function (data) {
      rows.push(data);
    })
    .on('end', function () {
      defer.resolve(rows);
    });
  return defer.promise;
}

function groupBy(group, data) {
  var groups = {};
  data.map(function (d) {
    if (groups[d[group]]) {
      groups[d[group]].push(d);
    }
    else {
      groups[d[group]] = [d];
    }
  })
  return groups;
}

function parseData() {
  var defer = Q.defer();
  async.series({
      wiki: function (callback) {
        parsecvs(path + '/wiki.csv').then(function (data) {
          console.log("Wikipedia records: " + data.length);
          callback(null, data);
        })
      },
      category: function (callback) {
        parsecvs(path + '/category.csv').then(function (data) {
          console.log("categories: " + data.length);
          callback(null, groupBy("URL", data));
        })
      },
      links: function (callback) {
        parsecvs(path + '/haslink.csv').then(function (data) {
          console.log("links: " + data.length);
          callback(null, groupBy("URL", data));
        })
      },
      headings: function (callback) {
        parsecvs(path + '/heading.csv').then(function (data) {
          console.log("headings: " + data.length);
          callback(null, groupBy("URL", data));
        })
      }
    },
    function (err, results) {
      var wiki = [];
      results.wiki.forEach(function (w) {
        var categories = results.category[w.URL] || [];
        var headings = results.headings[w.URL] || [];
        var links = results.links[w.URL] || [];
        wiki.push({
          title: w.TITLE,
          url: w.URL,
          abstract: w.ABSTRACT,
          categories: categories.map(function (c) {
            return c.CATEGORY
          }),
          headings: headings.map(function (h) {
            return {heading: h.HEADING, position: h.HEADING_POSITION}
          }),
          links: links.map(function (l) {
            return l.LINK
          })
        });
      });
      defer.resolve(wiki);
    })
  return defer.promise;
}
function makeSliceFunction(data, start, end) {
  var dataSlice = data.slice(start, end);
  return function (callback) {
    var s = start;
    var e = end - 1;
    console.log("Storing document: " + s + ", to: " + e);
    WikiModel.collection.insert(dataSlice, function (err) {
      if (err) return callback(err);
      callback(null);

    });
  }
};

function databaseInsert(data) {
  mongoose.connect(dbUrl);
  mongoose.connection.on('error', function (err) {
    console.log(err);
  });
  mongoose.connection.once('open', function callback() {
    console.log("Connect to: " + dbUrl);

    WikiModel.remove().exec();

    //Comment this out, if population on MongoLab fails
    //data = data.filter(function (d) {
    //  return JSON.stringify(d).length < 1500;
    //});

    console.log("adding " + data.length + " wiki objects to " + dbUrl);

    //There seems to be a maximum of 1000 documents on Bulk operations with the newer versions of MongoDB/mongoose
    var maxSlice = 1000;
    var tasks = []
    for (var i = 0; i < data.length; i += maxSlice) {
      var end = i + maxSlice < data.length ? i + maxSlice : data.length;
      //console.log(i+maxSlice-1 +" : " +data.length);
      tasks.push(makeSliceFunction(data, i, end, callback));
    }
    async.series(tasks, function (err) {
      if (err) {
        return console.log("Uuuups: " + err);
      }
      WikiModel.count({}, function (err, count) {
        console.log("All " + count + " Wiki's stored in the Database");
        mongoose.connection.close();
      })
    });
  });
}

fs.exists(path + "/wiki.json", function (excists) {
  if (excists) {
    fs.readFile(path + "/wiki.json", "utf8", function (err, data) {
      if (err) console.log(err);
      else {
        databaseInsert(JSON.parse(data));
      }
    });
  }
  else {
    parseData().then(function (data) {
      var out = fs.createWriteStream(path + "/wiki.json");
      out.write(JSON.stringify(data));
      databaseInsert(data);
    });
  }
});



