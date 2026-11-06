/**
 * A widget to select a folder from Google Drive.
 * Supports two selection methods:
 * 1. Pasting a folder URL
 *    - can be the URL, folder ID, or Sharing URL
 * 2. Using the Google Picker
 */
'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import TextField from 'material-ui/TextField';
import RaisedButton from 'material-ui/RaisedButton';
import { parseURL } from '../util/helpers';
import FolderLink from './FolderLink';

export default class SelectFolder extends React.Component {
  constructor() {
    super();
    this.state = {
      value: ''
    };
    this.launchPicker = this.launchPicker.bind(this);
    this.handlePaste = this.handlePaste.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.reset = this.reset.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  launchPicker() {
    this.props.picker.showPicker();
  }

  reset() {
    this.setState({ value: '' });
    this.props.reset();
  }

  handleChange(e) {
    this.setState({ value: e.target.value });
  }

  handleSubmit(e) {
    e.preventDefault();
    this.selectFolder(this.state.value);
  }

  handlePaste(e) {
    e.preventDefault();
    this.selectFolder(e.clipboardData.getData('Text'));
  }

  selectFolder(input) {
    const url = input.trim();
    if (!url) return;
    const id = parseURL(url);
    this.setState({ value: url });
    this.props.processing('Getting folder info');
    const _this = this;
    if (process.env.NODE_ENV === 'production') {
      google.script.run
        .withSuccessHandler(folder => {
          var parentid =
            folder.parents && folder.parents[0] ? folder.parents[0].id : null;
          _this.reset();
          _this.props.handleFolderSelect(folder.id, folder.title, parentid);
        })
        .withFailureHandler(err => {
          _this.props.showError(err.message);
        })
        .getMetadata(id, url);
    } else {
      // TEST MODE
      // ======================
      const _this = this;
      return setTimeout(function() {
        _this.reset();
        return _this.props.handleFolderSelect(id, 'test mode folder', id);
      }, 1000);
    }
  }

  render() {
    if (this.props.folderID && this.props.folderID !== '') {
      return (
        <div>
          <h4>You selected</h4>
          <FolderLink
            folderID={this.props.folderID}
            name={this.props.folderName}
          />
          <RaisedButton
            label="Select a different folder"
            primary={false}
            onClick={this.reset}
            style={{ marginLeft: '1em' }}
          />
        </div>
      );
    }

    return (
      <form onSubmit={this.handleSubmit}>
        <TextField
          floatingLabelText="Folder URL or ID"
          key="folderName"
          id="folderName"
          name="folderName"
          onChange={this.handleChange}
          onPaste={this.handlePaste}
          value={this.state.value}
        />
        <RaisedButton
          type="submit"
          label="Select folder"
          disabled={!this.state.value.trim()}
          style={{ marginLeft: '1em' }}
        />
        {this.props.picker && [
          <span className="circle-or" key="1">
            or
          </span>,
          <RaisedButton
            key="2"
            type="button"
            label="Search your Drive"
            primary={true}
            onClick={this.launchPicker}
          />
        ]}
      </form>
    );
  }
}

SelectFolder.propTypes = {
  handleFolderSelect: PropTypes.func.isRequired,
  processing: PropTypes.func.isRequired,
  showError: PropTypes.func.isRequired,
  picker: PropTypes.object,
  folderID: PropTypes.string,
  folderName: PropTypes.string
};
