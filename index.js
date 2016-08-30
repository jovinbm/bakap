require('dotenv').config({path: './.prf/.env'});

const nconf = require('nconf');

nconf.use('memory');
nconf
  .env();

const BPromise   = require('bluebird');
const gulp       = require('gulp');
const awspublish = require('gulp-awspublish');
const cron       = require('cron');
const ajv        = require('ajv')({
  removeAdditional: false
});

const config = require('./.prf/config.json');

const config_schema = {
  type    : 'array',
  minItems: 1,
  items   : {
    type                : 'object',
    required            : ['acl', 'bucket_name', 'region', 'gulp_src', 'gulp_base', 'cron_time'],
    additionalProperties: false,
    properties          : {
      name       : {
        type     : 'string',
        minLength: 1
      },
      acl        : {
        type: 'string',
        enum: ['private', 'public-read', 'public-read-write', 'authenticated-read']
      },
      bucket_name: {
        type     : 'string',
        minLength: 1
      },
      region     : {
        type     : 'string',
        minLength: 1
      },
      gulp_src   : {
        type     : 'string',
        minLength: 1
      },
      gulp_base  : {
        type     : 'string',
        minLength: 1
      },
      cron_time  : {
        type: 'string'
      }
    }
  }
};

const config_validate = ajv.compile(config_schema);

const Bakap = function () {
  const self = this;
  
  self.name = 'Bakap';
};

/**
 *
 * @param {object} opts
 * @param {string} opts.acl
 * @param {string} opts.bucket_name
 * @param {string} opts.region
 * @param {string} opts.gulp_src
 * @param {string} opts.gulp_base
 */
Bakap.prototype.upload = function (opts) {
  
  return BPromise.resolve()
    .then(function () {
      
      const publisher = awspublish.create({
        region         : opts.region,
        params         : {
          Bucket: opts.bucket_name
        },
        accessKeyId    : nconf.get('AWS_S3_ACCESS_KEY_ID'),
        secretAccessKey: nconf.get('AWS_S3_ACCESS_KEY_SECRET')
      });
      
      const headers = {
        'x-amz-acl': opts.acl
      };
      
      return gulp.src(opts.gulp_src, {base: opts.gulp_base})
        .pipe(publisher.publish(headers, {
          force: true
        }))
        .pipe(awspublish.reporter());
      
    })
    .catch(function (e) {
      
      console.error(e);
      
      return true;
      
    });
  
};

/**
 *
 * @param {object[]} config
 */
Bakap.prototype.initialize = function (config) {
  const self    = this;
  const CronJob = cron.CronJob;
  
  // validate
  const valid = config_validate(config);
  
  if (!valid) {
    const e = new Error(ajv.errorsText(config_validate.errors));
    
    e.ajv = config_validate.errors;
    throw e;
  }
  
  return BPromise.resolve()
    .then(function () {
      
      // validate cron_time
      
      return BPromise.each(config, function (opts) {
        
        return BPromise.resolve()
          .then(function () {
            
            new CronJob(opts.cron_time, function () {
              return true;
            });
            
          })
          .catch(function (e) {
            
            const err = new Error(`Invalid cron time:: ${opts.cron_time}, at:: ${opts.name}`);
            
            err.stack = e.stack;
            err.name  = e.name;
            
            throw err;
            
          });
        
      });
      
    })
    .then(function () {
      
      // backup all first
      
      return BPromise.map(config, function (opts) {
        
        return self.upload(opts);
        
      }, {concurrency: 2});
      
    })
    .then(function () {
      
      // setup crons
      
      return BPromise.each(config, function (opts) {
        
        const job = new CronJob({
          cronTime: opts.cron_time,
          onTick  : function () {
            console.log(`Executing:: ${opts.name}`);
            self.upload(opts);
          }
        });
        
        job.start();
        
      });
      
    })
    .catch(function (e) {
      
      throw e;
      
    });
  
};

const bakap = new Bakap();

bakap.initialize(config);